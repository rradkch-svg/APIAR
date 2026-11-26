import { dbQuery } from "../db/client";
import { scaleDelayMs } from "../config/runtime";
import { isPersonaOnline, type PersonaRow, type TimeSlot } from "../personas/metadata";

export interface PersonaWithState extends PersonaRow {
  user_affinity: number;
  user_trust: number;
  user_romantic_tension: number;
  user_mood: string;
  user_stage: string;
  persona_follows_back: boolean;
}

export interface ReplyEdgeCandidate {
  responder_id: string;
  relation_type: string;
  affinity: number;
  friction: number;
  shared_lore: string;
}

/**
 * Realistic engagement calculation:
 * - New user with 0 followers starts at 0 likes & a handful of campus Explore views (NO fake instant likes!).
 * - Existing campus personas have realistic campus follower engagement.
 */
export async function computeInitialPostEngagement(
  userId: string,
  postBody: string,
  isUserPost = true
): Promise<{ likesCount: number; viewsCount: number }> {
  if (!isUserPost) {
    const likes = 14 + Math.floor(Math.random() * 44);
    const views = likes * (4 + Math.floor(Math.random() * 4)) + Math.floor(Math.random() * 35);
    return { likesCount: likes, viewsCount: views };
  }

  const states = await dbQuery<{
    affinity: number;
    persona_follows_back: boolean;
    triggers: { positive?: string[] };
  }>(
    `SELECT ups.affinity, ups.persona_follows_back, p.triggers
     FROM user_persona_state ups
     JOIN personas p ON p.id = ups.persona_id
     WHERE ups.user_id = $1`,
    [userId]
  );

  const lower = postBody.toLowerCase();
  let followers = 0;
  let likes = 0;
  let views = 1;

  for (const row of states.rows) {
    if (row.persona_follows_back) followers += 1;
    const pos = Array.isArray(row.triggers?.positive) ? row.triggers.positive : [];
    const hit = pos.some((t) => lower.includes(t.toLowerCase()));
    if (row.persona_follows_back || row.affinity >= 25 || hit) views += 2;
    if ((row.persona_follows_back && row.affinity >= 35) || (row.affinity >= 45 && hit)) {
      likes += 1;
    }
  }

  if (followers === 0) {
    return { likesCount: 0, viewsCount: Math.max(2, views) };
  }

  return {
    likesCount: likes,
    viewsCount: Math.max(views + followers * 3, likes + 4),
  };
}

/**
 * Selects commenters realistically:
 * - On a brand-new student's post (0 followers, max affinity < 15), ONLY 1–2 curious/active students comment casually.
 * - Once you have followers/friends (or on a campus persona's own post), 3–5 commenters + C1->C2 graph drama!
 */
export async function selectInitialCommenters(
  userId: string,
  postBody: string,
  currentSlot: TimeSlot,
  options?: { isUserPost?: boolean; authorPersonaId?: string | null; audience?: string }
): Promise<PersonaWithState[]> {
  const isUserPost = options?.isUserPost !== false;
  const audience = options?.audience || "campus";

  const res = await dbQuery<PersonaWithState>(
    `SELECT
       p.*,
       ups.affinity AS user_affinity,
       ups.trust AS user_trust,
       ups.romantic_tension AS user_romantic_tension,
       ups.current_mood AS user_mood,
       ups.relationship_stage AS user_stage,
       ups.persona_follows_back,
       ups.is_close_friend
     FROM personas p
     JOIN user_persona_state ups ON ups.persona_id = p.id
     WHERE ups.user_id = $1
       AND p.is_active = TRUE
       ${options?.authorPersonaId ? "AND p.id <> $2" : ""}
       ${isUserPost && audience === "close_friends" ? "AND ups.is_close_friend = TRUE" : ""}`,
    options?.authorPersonaId ? [userId, options.authorPersonaId] : [userId]
  );

  const all = res.rows;
  if (all.length === 0) return [];

  const lower = postBody.toLowerCase();
  const maxAffinity = Math.max(0, ...all.map((p) => p.user_affinity));
  const followerCount = all.filter((p) => p.persona_follows_back).length;

  // Cold-start brand-new student: don't swarm with 5 strangers! Pick 1–2 curious/trigger-matched students.
  if (isUserPost && maxAffinity < 15 && followerCount === 0) {
    const scored = all
      .map((p) => {
        let score = isPersonaOnline(p.activity_schedule, currentSlot) ? 2 : 0;
        const pos = p.triggers?.positive || [];
        const neg = p.triggers?.negative || [];
        for (const t of pos) if (lower.includes(t.toLowerCase())) score += 5;
        for (const t of neg) if (lower.includes(t.toLowerCase())) score += 5;
        if (["leo", "nina", "lauren", "mel", "chloe", "parker"].includes(p.id)) score += 2;
        score += Math.random() * 1.5;
        return { p, score };
      })
      .sort((a, b) => b.score - a.score);

    const coldCount = scored[0] && scored[0].score >= 6 ? 2 : 1;
    return scored.slice(0, Math.min(coldCount, scored.length)).map((x) => x.p);
  }

  const selected = new Map<string, PersonaWithState>();

  // 1) Top 2 by affinity / follow-back
  const byAffinity = [...all].sort(
    (a, b) =>
      (b.persona_follows_back ? 20 : 0) + b.user_affinity - ((a.persona_follows_back ? 20 : 0) + a.user_affinity)
  );
  for (const p of byAffinity.slice(0, 2)) {
    selected.set(p.id, p);
  }

  // 2) 1 with strongest text trigger match or rivalry
  const remainingForTrigger = all.filter((p) => !selected.has(p.id));
  const scoredTrigger = remainingForTrigger
    .map((p) => {
      const pos = p.triggers?.positive || [];
      const neg = p.triggers?.negative || [];
      let score = 0;
      for (const t of pos) if (lower.includes(t.toLowerCase())) score += 4;
      for (const t of neg) if (lower.includes(t.toLowerCase())) score += 6;
      if (lower.includes(p.id) || lower.includes(p.display_name.split(" ")[0].toLowerCase())) {
        score += 8;
      }
      if (p.user_stage === "rival") score += 4;
      if (p.clique === "drama") score += 1.5;
      return { persona: p, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scoredTrigger[0]) {
    selected.set(scoredTrigger[0].persona.id, scoredTrigger[0].persona);
  }

  // 3) 1 to 2 active personas in current time slot
  const remainingActive = all.filter(
    (p) => !selected.has(p.id) && isPersonaOnline(p.activity_schedule, currentSlot)
  );
  const pool =
    remainingActive.length > 0 ? remainingActive : all.filter((p) => !selected.has(p.id));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const extraCount = Math.min(shuffled.length, Math.random() < 0.55 ? 2 : 1);
  for (const p of shuffled.slice(0, extraCount)) {
    selected.set(p.id, p);
  }

  return Array.from(selected.values()).slice(0, 5);
}

export async function findReplyCandidatesForCommenter(
  commenterId: string,
  excludeIds: string[] = []
): Promise<ReplyEdgeCandidate[]> {
  const incoming = await dbQuery<ReplyEdgeCandidate>(
    `SELECT
       source_id AS responder_id,
       relation_type,
       affinity,
       friction,
       shared_lore
     FROM persona_edges
     WHERE target_id = $1
       AND (friction > 0.65 OR affinity > 75)
     ORDER BY friction DESC, affinity DESC`,
    [commenterId]
  );

  const outgoing = await dbQuery<ReplyEdgeCandidate>(
    `SELECT
       target_id AS responder_id,
       relation_type,
       affinity,
       friction,
       shared_lore
     FROM persona_edges
     WHERE source_id = $1
       AND (friction > 0.65 OR affinity > 75)
     ORDER BY friction DESC, affinity DESC`,
    [commenterId]
  );

  const seen = new Set<string>([commenterId, ...excludeIds]);
  const combined: ReplyEdgeCandidate[] = [];

  for (const row of [...incoming.rows, ...outgoing.rows]) {
    if (!seen.has(row.responder_id)) {
      seen.add(row.responder_id);
      combined.push(row);
    }
  }

  return combined.sort((a, b) => {
    const aFight = a.friction > 0.65 ? 1 : 0;
    const bFight = b.friction > 0.65 ? 1 : 0;
    if (aFight !== bFight) return bFight - aFight;
    return b.friction - a.friction || b.affinity - a.affinity;
  });
}

export async function scheduleFeedCascadeJobs(params: {
  userId: string;
  postId: string;
  postBody: string;
  imageCaption?: string | null;
  currentSlot: TimeSlot;
  isUserPost?: boolean;
  authorPersonaId?: string | null;
  audience?: string;
  extraDramaCommenter?: { personaId: string; reason: string } | null;
}): Promise<{
  scheduledCommenters: string[];
  plannedReplies: Array<{ parent: string; responder: string; relation: string }>;
}> {
  const commenters = await selectInitialCommenters(
    params.userId,
    `${params.postBody} ${params.imageCaption ?? ""}`,
    params.currentSlot,
    {
      isUserPost: params.isUserPost,
      authorPersonaId: params.authorPersonaId,
      audience: params.audience,
    }
  );

  const commenterIds = commenters.map((c) => c.id);
  const plannedReplies: Array<{ parent: string; responder: string; relation: string }> = [];
  let replyQuota = commenters.length >= 3 ? 2 : 1;

  for (let i = 0; i < commenters.length; i++) {
    const p = commenters[i];
    const [minSec, maxSec] = p.typing_style?.delay_sec_range || [14, 55];
    const literalMs = (minSec + Math.random() * Math.max(8, maxSec - minSec)) * 1000;
    const delayMs = scaleDelayMs(literalMs + i * 9000, i === 0 ? 4500 : 8000);

    let replyPlan: ReplyEdgeCandidate | null = null;
    if (replyQuota > 0) {
      const candidates = await findReplyCandidatesForCommenter(p.id, [
        ...plannedReplies.map((r) => r.responder),
        ...(params.authorPersonaId ? [params.authorPersonaId] : []),
      ]);
      if (candidates[0]) {
        replyPlan = candidates[0];
        replyQuota--;
        plannedReplies.push({
          parent: p.id,
          responder: candidates[0].responder_id,
          relation: candidates[0].relation_type,
        });
      }
    }

    const runAt = new Date(Date.now() + delayMs);
    await dbQuery(
      `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
       VALUES ($1, 'feed_comment', $2::jsonb, $3, 'pending')`,
      [
        params.userId,
        JSON.stringify({
          post_id: params.postId,
          persona_id: p.id,
          reply_plan: replyPlan,
        }),
        runAt.toISOString(),
      ]
    );
  }

  if (params.extraDramaCommenter && !commenterIds.includes(params.extraDramaCommenter.personaId)) {
    const runAt = new Date(Date.now() + scaleDelayMs(25000, 3500));
    await dbQuery(
      `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
       VALUES ($1, 'feed_comment', $2::jsonb, $3, 'pending')`,
      [
        params.userId,
        JSON.stringify({
          post_id: params.postId,
          persona_id: params.extraDramaCommenter.personaId,
          extra_context: params.extraDramaCommenter.reason,
          reply_plan: null,
        }),
        runAt.toISOString(),
      ]
    );
    commenterIds.push(params.extraDramaCommenter.personaId);
  }

  return { scheduledCommenters: commenterIds, plannedReplies };
}
