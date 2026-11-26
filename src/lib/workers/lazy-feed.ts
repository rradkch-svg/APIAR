import { dbQuery, dbQueryOne } from "../db/client";
import type { UserRow } from "../db/session";
import type { PersonaRow } from "../personas/metadata";
import { generateBotNote, generateBotPost, generateBotStory } from "../llm/router";
import { generatePhotorealisticImage } from "../media/image-engine";
import { computeInitialPostEngagement, scheduleFeedCascadeJobs } from "../graph/selector";

export async function createAutonomousBotPost(params: {
  user: UserRow;
  persona?: PersonaRow;
  contextHint?: string;
  extraDramaCommenter?: { personaId: string; reason: string } | null;
  withCascade?: boolean;
  seedInitialComments?: boolean;
}): Promise<{ id: string; author_persona_id: string; body: string; image_url: string | null } | null> {
  let persona = params.persona;
  if (!persona) {
    const res = await dbQuery<PersonaRow>(
      `SELECT p.* FROM personas p
       WHERE p.is_active = TRUE
       ORDER BY RANDOM()
       LIMIT 1`
    );
    persona = res.rows[0];
  }
  if (!persona) return null;

  const generated = await generateBotPost({
    persona,
    user: params.user,
    contextHint: params.contextHint,
  });

  // Avoid reusing recent photos already visible in the Feed!
  const recentUrlsRes = await dbQuery<{ image_url: string }>(
    `SELECT image_url FROM posts
     WHERE user_id = $1 AND image_url IS NOT NULL
     ORDER BY created_at DESC LIMIT 12`,
    [params.user.id]
  );
  const excludeUrls = recentUrlsRes.rows.map((r) => r.image_url);

  // Always generate a photorealistic campus photograph for Instagram feed authenticity!
  const photo = await generatePhotorealisticImage({
    persona,
    prompt: generated.image_prompt || generated.body,
    sceneKind: "post",
    excludeUrls,
  });

  const locationTag = generated.location_tag || photo.location || "Main Quad";
  const engagement = await computeInitialPostEngagement(params.user.id, generated.body, false);

  const inserted = await dbQueryOne<{
    id: string;
    author_persona_id: string;
    body: string;
    image_url: string | null;
  }>(
    `INSERT INTO posts (
      user_id, author_type, author_persona_id, body, image_url, media_urls, location_tag, audience, likes_count, views_count
    ) VALUES ($1, 'persona', $2, $3, $4, $5::jsonb, $6, 'campus', $7, $8)
    RETURNING id, author_persona_id, body, image_url`,
    [
      params.user.id,
      persona.id,
      generated.body,
      photo.imageUrl,
      JSON.stringify([photo.imageUrl]),
      locationTag,
      engagement.likesCount,
      engagement.viewsCount,
    ]
  );

  // Seed authentic relational bot likes from their graph friends!
  if (inserted) {
    const friends = await dbQuery<{ source_id: string }>(
      `SELECT source_id FROM persona_edges
       WHERE target_id = $1 AND affinity >= 40
       ORDER BY affinity DESC
       LIMIT 4`,
      [persona.id]
    );
    for (const f of friends.rows) {
      await dbQuery(
        `INSERT INTO post_likes (post_id, user_id, liker_type, liker_persona_id)
         VALUES ($1, $2, 'persona', $3)
         ON CONFLICT DO NOTHING`,
        [inserted.id, params.user.id, f.source_id]
      );
    }
  }

  if (inserted && params.withCascade !== false) {
    await scheduleFeedCascadeJobs({
      userId: params.user.id,
      postId: inserted.id,
      postBody: inserted.body,
      currentSlot: params.user.current_slot,
      isUserPost: false,
      authorPersonaId: persona.id,
      extraDramaCommenter: params.extraDramaCommenter,
    });
  }

  return inserted;
}

/**
 * Seeds authentic 24h campus Stories (with real photorealistic photos) and DM Notes.
 */
export async function refreshCampusStoriesAndNotes(user: UserRow, count = 6): Promise<void> {
  // 1. Ensure fresh active persona Stories
  const activeStories = await dbQueryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM stories
     WHERE user_id = $1 AND author_type = 'persona' AND expires_at > NOW()`,
    [user.id]
  );

  if (Number(activeStories?.count ?? 0) < 4) {
    // Collect currently visible feed + story photo URLs so EVERY story has a distinct photograph!
    const usedRes = await dbQuery<{ url: string }>(
      `SELECT image_url AS url FROM posts WHERE user_id = $1 AND image_url IS NOT NULL
       UNION
       SELECT media_url AS url FROM stories WHERE user_id = $1 AND expires_at > NOW()`,
      [user.id]
    );
    const usedUrls = usedRes.rows.map((r) => r.url);

    const personas = await dbQuery<PersonaRow>(
      `SELECT * FROM personas WHERE is_active = TRUE ORDER BY RANDOM() LIMIT $1`,
      [count]
    );
    const storyDrafts = await Promise.all(
      personas.rows.map(async (p) => ({
        persona: p,
        draft: await generateBotStory({ persona: p, user }),
      }))
    );
    for (const { persona: p, draft: storyDraft } of storyDrafts) {
      const photo = await generatePhotorealisticImage({
        persona: p,
        prompt: storyDraft.image_prompt,
        sceneKind: "story",
        excludeUrls: usedUrls,
      });
      usedUrls.push(photo.imageUrl);
      await dbQuery(
        `INSERT INTO stories (user_id, author_type, author_persona_id, media_url, caption, audience)
         VALUES ($1, 'persona', $2, $3, $4, 'campus')`,
        [user.id, p.id, photo.imageUrl, storyDraft.caption]
      );
    }
  }

  // 2. Ensure fresh active persona DM Notes (60-char campus thoughts)
  const activeNotes = await dbQueryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM dm_notes
     WHERE user_id = $1 AND author_type = 'persona' AND expires_at > NOW()`,
    [user.id]
  );

  if (Number(activeNotes?.count ?? 0) < 5) {
    const notePersonas = await dbQuery<PersonaRow>(
      `SELECT * FROM personas WHERE is_active = TRUE ORDER BY RANDOM() LIMIT 6`
    );
    const noteDrafts = await Promise.all(
      notePersonas.rows.map(async (p) => ({
        persona: p,
        note: await generateBotNote({ persona: p, user }),
      }))
    );
    for (const { persona: p, note } of noteDrafts) {
      await dbQuery(
        `DELETE FROM dm_notes WHERE user_id = $1 AND author_persona_id = $2`,
        [user.id, p.id]
      );
      await dbQuery(
        `INSERT INTO dm_notes (user_id, author_type, author_persona_id, body)
         VALUES ($1, 'persona', $2, $3)`,
        [user.id, p.id, note.body.slice(0, 60)]
      );
    }
  }
}

export async function maybeRunLazyFeedGeneration(user: UserRow): Promise<boolean> {
  const latest = await dbQueryOne<{ created_at: string }>(
    `SELECT created_at FROM posts
     WHERE user_id = $1 AND author_type = 'persona'
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id]
  );

  if (!latest) {
    await createAutonomousBotPost({ user, withCascade: false });
    return true;
  }

  const hoursSince = (Date.now() - new Date(latest.created_at).getTime()) / (1000 * 60 * 60);
  if (hoursSince >= 4) {
    await createAutonomousBotPost({ user, withCascade: true });
    return true;
  }

  return false;
}
