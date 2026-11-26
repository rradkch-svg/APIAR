import { dbQuery, dbQueryOne } from "../db/client";
import { scaleDelayMs } from "../config/runtime";
import type { UserRow } from "../db/session";
import type { PersonaRow } from "../personas/metadata";
import { emitRealtimeEvent } from "../realtime/bus";
import {
  extractMemoriesFromMessages,
  generateFeedComment,
  generateProactiveDm,
} from "../llm/router";
import { retrieveTopMemories, storeMemoryWithEmbedding } from "../llm/embeddings";
import { propagateGossip } from "../graph/gossip";
import { applyUserPersonaStateUpdate, deliverPersonaTurnBubbles } from "./deliver";
import { createAutonomousBotPost } from "./lazy-feed";
import type { ReplyEdgeCandidate } from "../graph/selector";

export interface ScheduledJobRow {
  id: string;
  user_id: string;
  job_type:
    | "feed_comment"
    | "comment_reply"
    | "gossip_leak"
    | "proactive_dm"
    | "bot_post"
    | "memory_extract"
    | "follow_decision";
  payload: Record<string, unknown>;
  run_at: string;
  status: string;
  attempts: number;
}

const GUARDED_FOLLOW_BACK = new Set([
  "cole",
  "sofia",
  "jade",
  "ezra",
  "victor",
  "maya",
  "helena",
  "camila",
]);

export async function executeScheduledJob(job: ScheduledJobRow): Promise<void> {
  const user = await dbQueryOne<UserRow>("SELECT * FROM users WHERE id = $1", [job.user_id]);
  if (!user) return;

  switch (job.job_type) {
    case "feed_comment":
      await handleFeedCommentJob(user, job.payload);
      return;
    case "comment_reply":
      await handleCommentReplyJob(user, job.payload);
      return;
    case "gossip_leak":
      await handleGossipLeakJob(user, job.payload);
      return;
    case "proactive_dm":
      await handleProactiveDmJob(user, job.payload);
      return;
    case "bot_post":
      await handleBotPostJob(user, job.payload);
      return;
    case "memory_extract":
      await handleMemoryExtractJob(user, job.payload);
      return;
    case "follow_decision":
      await handleFollowDecisionJob(user, job.payload);
      return;
  }
}

async function handleFeedCommentJob(user: UserRow, payload: Record<string, unknown>) {
  const postId = String(payload.post_id || "");
  const personaId = String(payload.persona_id || "");
  const extraContext = payload.extra_context ? String(payload.extra_context) : null;
  const replyPlan = (payload.reply_plan as ReplyEdgeCandidate | null) ?? null;

  const [post, persona, state] = await Promise.all([
    dbQueryOne<{
      id: string;
      body: string;
      author_type: "user" | "persona";
      author_persona_id: string | null;
      image_caption_ai: string | null;
      likes_count: number;
      views_count: number;
    }>(
      "SELECT id, body, author_type, author_persona_id, image_caption_ai, likes_count, views_count FROM posts WHERE id = $1",
      [postId]
    ),
    dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [personaId]),
    dbQueryOne<{
      affinity: number;
      trust: number;
      romantic_tension: number;
      current_mood: string;
      internal_thought: string;
      relationship_stage: string;
      persona_follows_back: boolean;
    }>(
      `SELECT affinity, trust, romantic_tension, current_mood, internal_thought, relationship_stage, persona_follows_back
       FROM user_persona_state
       WHERE user_id = $1 AND persona_id = $2`,
      [user.id, personaId]
    ),
  ]);

  if (!post || !persona) return;

  const postAuthorPersona =
    post.author_type === "persona" && post.author_persona_id
      ? await dbQueryOne<{ display_name: string; handle: string }>(
          "SELECT display_name, handle FROM personas WHERE id = $1",
          [post.author_persona_id]
        )
      : null;

  const { output } = await generateFeedComment({
    persona,
    user,
    postBody: post.body,
    postAuthorName: postAuthorPersona?.display_name || user.display_name,
    postAuthorHandle: postAuthorPersona?.handle || user.handle,
    isUserPost: post.author_type === "user",
    state,
    imageCaption: post.image_caption_ai,
    extraContext,
  });

  const inserted = await dbQueryOne<{ id: string; created_at: string }>(
    `INSERT INTO comments (post_id, user_id, parent_comment_id, author_type, author_persona_id, body, likes_count)
     VALUES ($1, $2, NULL, 'persona', $3, $4, $5)
     RETURNING id, created_at`,
    [post.id, user.id, persona.id, output.comment, Math.floor(Math.random() * 3)]
  );

  if (!inserted) return;

  if (output.likes_post) {
    await dbQuery(
      `INSERT INTO post_likes (post_id, user_id, liker_type, liker_persona_id)
       VALUES ($1, $2, 'persona', $3)
       ON CONFLICT DO NOTHING`,
      [post.id, user.id, persona.id]
    );
    const bumped = await dbQueryOne<{ likes_count: number; views_count: number }>(
      `UPDATE posts
       SET likes_count = likes_count + 1, views_count = views_count + 2
       WHERE id = $1
       RETURNING likes_count, views_count`,
      [post.id]
    );
    if (bumped) {
      emitRealtimeEvent(user.id, "feed:likes_bump", {
        post_id: post.id,
        likes_count: bumped.likes_count,
        views_count: bumped.views_count,
      });
    }
  }

  if (post.author_type === "user" && output.affinity_delta !== 0) {
    await applyUserPersonaStateUpdate(user.id, persona.id, {
      affinityDelta: output.affinity_delta,
    });
  }

  emitRealtimeEvent(user.id, "feed:comment", {
    post_id: post.id,
    comment: {
      id: inserted.id,
      post_id: post.id,
      parent_comment_id: null,
      author_type: "persona",
      author_persona_id: persona.id,
      author_name: persona.display_name,
      author_handle: persona.handle,
      author_avatar: persona.avatar_url,
      author_accent: persona.accent_color,
      body: output.comment,
      likes_count: 0,
      created_at: inserted.created_at,
    },
  });

  if (replyPlan?.responder_id) {
    const literalMs = (25 + Math.random() * 140) * 1000;
    const delayMs = scaleDelayMs(literalMs, 3500);
    await dbQuery(
      `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
       VALUES ($1, 'comment_reply', $2::jsonb, $3, 'pending')`,
      [
        user.id,
        JSON.stringify({
          post_id: post.id,
          parent_comment_id: inserted.id,
          parent_author_id: persona.id,
          responder_id: replyPlan.responder_id,
          edge: replyPlan,
        }),
        new Date(Date.now() + delayMs).toISOString(),
      ]
    );
  }
}

async function handleCommentReplyJob(user: UserRow, payload: Record<string, unknown>) {
  const postId = String(payload.post_id || "");
  const parentCommentId = String(payload.parent_comment_id || "");
  const responderId = String(payload.responder_id || "");
  const edge = payload.edge as ReplyEdgeCandidate | undefined;

  const [post, parentComment, responder, state] = await Promise.all([
    dbQueryOne<{
      id: string;
      body: string;
      author_type: "user" | "persona";
      author_persona_id: string | null;
      image_caption_ai: string | null;
    }>(
      "SELECT id, body, author_type, author_persona_id, image_caption_ai FROM posts WHERE id = $1",
      [postId]
    ),
    dbQueryOne<{ id: string; body: string; author_type: "user" | "persona"; author_persona_id: string | null }>(
      "SELECT id, body, author_type, author_persona_id FROM comments WHERE id = $1",
      [parentCommentId]
    ),
    dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [responderId]),
    dbQueryOne<{
      affinity: number;
      trust: number;
      romantic_tension: number;
      current_mood: string;
      internal_thought: string;
      relationship_stage: string;
      persona_follows_back: boolean;
    }>(
      `SELECT affinity, trust, romantic_tension, current_mood, internal_thought, relationship_stage, persona_follows_back
       FROM user_persona_state
       WHERE user_id = $1 AND persona_id = $2`,
      [user.id, responderId]
    ),
  ]);

  if (!post || !parentComment || !responder) return;

  const parentAuthor = parentComment.author_persona_id
    ? await dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [
        parentComment.author_persona_id,
      ])
    : null;

  const postAuthorPersona =
    post.author_type === "persona" && post.author_persona_id
      ? await dbQueryOne<{ display_name: string; handle: string }>(
          "SELECT display_name, handle FROM personas WHERE id = $1",
          [post.author_persona_id]
        )
      : null;

  const { output } = await generateFeedComment({
    persona: responder,
    user,
    postBody: post.body,
    postAuthorName: postAuthorPersona?.display_name || user.display_name,
    postAuthorHandle: postAuthorPersona?.handle || user.handle,
    isUserPost: post.author_type === "user",
    state,
    imageCaption: post.image_caption_ai,
    parentComment: {
      body: parentComment.body,
      authorName: parentAuthor?.display_name || user.display_name,
    },
    edge: edge
      ? {
          relation_type: edge.relation_type,
          affinity: edge.affinity,
          friction: edge.friction,
          shared_lore: edge.shared_lore,
        }
      : null,
  });

  const inserted = await dbQueryOne<{ id: string; created_at: string }>(
    `INSERT INTO comments (post_id, user_id, parent_comment_id, author_type, author_persona_id, body, likes_count)
     VALUES ($1, $2, $3, 'persona', $4, $5, $6)
     RETURNING id, created_at`,
    [
      post.id,
      user.id,
      parentComment.id,
      responder.id,
      output.comment,
      Math.floor(Math.random() * 3) + 1,
    ]
  );

  if (!inserted) return;

  if (parentComment.author_type === "user" && output.affinity_delta !== 0) {
    await applyUserPersonaStateUpdate(user.id, responder.id, {
      affinityDelta: output.affinity_delta,
    });
  }

  emitRealtimeEvent(user.id, "feed:comment", {
    post_id: post.id,
    comment: {
      id: inserted.id,
      post_id: post.id,
      parent_comment_id: parentComment.id,
      author_type: "persona",
      author_persona_id: responder.id,
      author_name: responder.display_name,
      author_handle: responder.handle,
      author_avatar: responder.avatar_url,
      author_accent: responder.accent_color,
      body: output.comment,
      likes_count: 1,
      relation_to_parent: edge?.relation_type ?? null,
      created_at: inserted.created_at,
    },
  });

  if (parentComment.author_type === "user") {
    emitRealtimeEvent(user.id, "notification:push", {
      title: responder.display_name,
      body: `replied to your comment: "${output.comment.slice(0, 70)}"`,
      route: "/feed",
      accent_color: responder.accent_color,
      persona_id: responder.id,
    });
  } else if (edge && edge.friction > 0.65 && post.author_type === "user") {
    emitRealtimeEvent(user.id, "notification:push", {
      title: responder.display_name,
      body: `replied to ${parentAuthor?.display_name.split(" ")[0] || "someone"} on your post`,
      route: "/feed",
      accent_color: responder.accent_color,
      persona_id: responder.id,
    });
  }
}

async function handleFollowDecisionJob(user: UserRow, payload: Record<string, unknown>) {
  const personaId = String(payload.persona_id || "");
  if (!personaId) return;

  const [persona, state, postsCountRow] = await Promise.all([
    dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [personaId]),
    dbQueryOne<{ affinity: number; user_follows: boolean; persona_follows_back: boolean }>(
      `SELECT affinity, user_follows, persona_follows_back
       FROM user_persona_state
       WHERE user_id = $1 AND persona_id = $2`,
      [user.id, personaId]
    ),
    dbQueryOne<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM posts WHERE user_id = $1 AND author_type = 'user'",
      [user.id]
    ),
  ]);

  if (!persona || !state || !state.user_follows || state.persona_follows_back) return;

  const userHasProfileEffort = Boolean(user.bio?.trim()) || Number(postsCountRow?.count ?? 0) > 0;
  const isGuarded = GUARDED_FOLLOW_BACK.has(persona.id);

  // Realistic college follow-back odds: social/open classmates often follow back; guarded ones wait until you actually talk!
  const followBackChance = isGuarded
    ? state.affinity >= 15
      ? 0.55
      : 0.12
    : userHasProfileEffort
      ? 0.68
      : 0.42;

  if (Math.random() <= followBackChance) {
    await dbQuery(
      `UPDATE user_persona_state
       SET persona_follows_back = TRUE,
           affinity = LEAST(100, affinity + 3),
           updated_at = NOW()
       WHERE user_id = $1 AND persona_id = $2`,
      [user.id, persona.id]
    );
    emitRealtimeEvent(user.id, "notification:push", {
      title: persona.display_name,
      body: `${persona.handle} started following you back`,
      route: "/activity",
      accent_color: persona.accent_color,
      persona_id: persona.id,
    });
    emitRealtimeEvent(user.id, "world:update", { reason: "follow_back" });
  }
}

async function handleGossipLeakJob(user: UserRow, payload: Record<string, unknown>) {
  const originPersonaId = String(payload.origin_persona_id || "");
  const summary = String(payload.summary || "");
  const juiciness = Number(payload.juiciness || 0);
  if (!originPersonaId || !summary || juiciness < 6) return;

  await propagateGossip({
    userId: user.id,
    originPersonaId,
    summary,
    juiciness,
  });
}

async function handleProactiveDmJob(user: UserRow, payload: Record<string, unknown>) {
  const personaId = String(payload.persona_id || "");
  const reason = String(payload.reason || "Checking in on campus");
  const persona = await dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [personaId]);
  if (!persona) return;

  const [state, recentMsgs] = await Promise.all([
    dbQueryOne<{
      affinity: number;
      trust: number;
      romantic_tension: number;
      current_mood: string;
      internal_thought: string;
      relationship_stage: string;
    }>(
      `SELECT affinity, trust, romantic_tension, current_mood, internal_thought, relationship_stage
       FROM user_persona_state
       WHERE user_id = $1 AND persona_id = $2`,
      [user.id, persona.id]
    ),
    dbQuery<{ sender_type: string; body: string }>(
      `SELECT sender_type, body FROM dm_messages
       WHERE user_id = $1 AND persona_id = $2
       ORDER BY created_at DESC LIMIT 6`,
      [user.id, persona.id]
    ),
  ]);

  const memories = await retrieveTopMemories(user.id, persona.id, reason, 5);
  const generated = await generateProactiveDm({
    persona,
    user,
    state: state || {
      affinity: 0,
      trust: 0,
      romantic_tension: 0,
      current_mood: "chill",
      internal_thought: "",
      relationship_stage: "stranger",
    },
    reason,
    memories,
    recentHistory: [...recentMsgs.rows].reverse(),
    allowMedia: true,
  });

  const nextState = await applyUserPersonaStateUpdate(user.id, persona.id, {
    newMood: generated.new_mood,
    internalThought: generated.internal_thought,
    incrementUnread: true,
  });

  await deliverPersonaTurnBubbles({
    userId: user.id,
    persona,
    bubbles: generated.bubbles,
    mediaAttachment: generated.media_attachment,
    stateUpdate: nextState,
    instant: Boolean(payload.instant),
    pushNotification: true,
  });
}

async function handleBotPostJob(user: UserRow, payload: Record<string, unknown>) {
  const personaId = payload.persona_id ? String(payload.persona_id) : undefined;
  const persona = personaId
    ? (await dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [personaId])) ?? undefined
    : undefined;
  await createAutonomousBotPost({
    user,
    persona,
    contextHint: payload.context_hint ? String(payload.context_hint) : undefined,
    withCascade: true,
  });
}

async function handleMemoryExtractJob(user: UserRow, payload: Record<string, unknown>) {
  const personaId = String(payload.persona_id || "");
  const recentMessages = Array.isArray(payload.recent_messages)
    ? payload.recent_messages.map(String)
    : [];
  const sourceType = (payload.source_type as "direct" | "feed") || "direct";

  if (!personaId || recentMessages.length === 0) return;

  const existing = await dbQuery<{ fact: string }>(
    "SELECT fact FROM memories WHERE user_id = $1 AND persona_id = $2 ORDER BY created_at DESC LIMIT 20",
    [user.id, personaId]
  );

  const extracted = await extractMemoriesFromMessages({
    recentMessages,
    existingMemories: existing.rows.map((r) => r.fact),
  });

  for (const item of extracted.new_facts) {
    await storeMemoryWithEmbedding({
      userId: user.id,
      personaId,
      fact: item.fact,
      category: item.category,
      importance: item.importance,
      sourceType,
    });
  }
}
