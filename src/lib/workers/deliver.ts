import crypto from "crypto";
import { dbQuery, dbQueryOne } from "../db/client";
import { getRuntimeConfig } from "../config/runtime";
import { emitRealtimeEvent } from "../realtime/bus";
import { computeRelationshipStage, type PersonaRow } from "../personas/metadata";
import { getMediaUnlockTier, type MediaAttachmentDraft } from "../media/tiers";
import { resolveMediaAttachment } from "../media/pipeline";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PersistedDmRow {
  id: string;
  user_id: string;
  persona_id: string;
  sender_type: "user" | "persona" | "system";
  message_type:
    | "text"
    | "image"
    | "audio"
    | "video"
    | "screenshot_alert"
    | "post_share"
    | "event_invite"
    | "story_reply"
    | "note_reply";
  body: string;
  media_url: string | null;
  media_metadata: Record<string, unknown>;
  reaction?: string | null;
  reply_to_message_id?: string | null;
  read_at?: string | null;
  bubble_group_id: string | null;
  created_at: string;
}

export interface StateDeltaInput {
  affinityDelta?: number;
  trustDelta?: number;
  romanticDelta?: number;
  newMood?: string;
  internalThought?: string;
  incrementUnread?: boolean;
  incrementDmTurns?: boolean;
}

export async function applyUserPersonaStateUpdate(
  userId: string,
  personaId: string,
  update: StateDeltaInput
): Promise<{
  affinity: number;
  trust: number;
  romantic_tension: number;
  current_mood: string;
  internal_thought: string;
  relationship_stage: string;
  persona_follows_back: boolean;
  persona_added_close_friend: boolean;
}> {
  const current = await dbQueryOne<{
    affinity: number;
    trust: number;
    romantic_tension: number;
    current_mood: string;
    internal_thought: string;
    unread_count: number;
    persona_follows_back: boolean;
    persona_added_close_friend: boolean;
    is_rival: boolean;
    dm_turns_count: number;
  }>(
    `SELECT affinity, trust, romantic_tension, current_mood, internal_thought, unread_count,
            persona_follows_back, persona_added_close_friend, is_rival, dm_turns_count
     FROM user_persona_state
     WHERE user_id = $1 AND persona_id = $2`,
    [userId, personaId]
  );

  const prevAffinity = current?.affinity ?? 0;
  const prevTrust = current?.trust ?? 0;
  const nextAffinity = Math.max(0, Math.min(100, prevAffinity + (update.affinityDelta ?? 0)));
  const nextTrust = Math.max(0, Math.min(100, prevTrust + (update.trustDelta ?? 0)));
  const nextRomantic = Math.max(
    0,
    Math.min(100, (current?.romantic_tension ?? 0) + (update.romanticDelta ?? 0))
  );
  const nextMood = update.newMood || current?.current_mood || "chill";
  const nextThought = (update.internalThought || current?.internal_thought || "").slice(0, 160);
  const nextTurns = (current?.dm_turns_count ?? 0) + (update.incrementDmTurns ? 1 : 0);

  let nextIsRival = current?.is_rival ?? false;
  if ((update.affinityDelta ?? 0) <= -4 && nextAffinity < 18) {
    nextIsRival = true;
  } else if (nextAffinity >= 25) {
    nextIsRival = false;
  }

  const nextStage = computeRelationshipStage(nextAffinity, nextRomantic, nextIsRival);

  // Organic Follow-Back unlock once the persona genuinely warms up to the new student
  const followBackThreshold = GUARDED_FOLLOW_BACK.has(personaId) ? 24 : 16;
  const prevFollowsBack = Boolean(current?.persona_follows_back);
  const nextFollowsBack = prevFollowsBack || nextAffinity >= followBackThreshold;

  // Close Friends green ring only unlocked for real close friends!
  const prevCloseFriend = Boolean(current?.persona_added_close_friend);
  const nextCloseFriend =
    nextAffinity >= 60 && nextTrust >= 45
      ? true
      : nextAffinity < 40
        ? false
        : prevCloseFriend;

  await dbQuery(
    `UPDATE user_persona_state
     SET affinity = $3,
         trust = $4,
         romantic_tension = $5,
         current_mood = $6,
         internal_thought = $7,
         relationship_stage = $8,
         unread_count = CASE WHEN $9 THEN unread_count + 1 ELSE unread_count END,
         persona_follows_back = $10,
         persona_added_close_friend = $11,
         is_rival = $12,
         dm_turns_count = $13,
         last_interaction_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $1 AND persona_id = $2`,
    [
      userId,
      personaId,
      nextAffinity,
      nextTrust,
      nextRomantic,
      nextMood,
      nextThought,
      nextStage,
      Boolean(update.incrementUnread),
      nextFollowsBack,
      nextCloseFriend,
      nextIsRival,
      nextTurns,
    ]
  );

  // Emit authentic Instagram-style follow-back / Close Friends notifications when newly unlocked
  if (!prevFollowsBack && nextFollowsBack) {
    const p = await dbQueryOne<{ display_name: string; handle: string; accent_color: string }>(
      "SELECT display_name, handle, accent_color FROM personas WHERE id = $1",
      [personaId]
    );
    if (p) {
      emitRealtimeEvent(userId, "notification:push", {
        title: p.display_name,
        body: `${p.handle} started following you`,
        route: "/activity",
        accent_color: p.accent_color,
        persona_id: personaId,
      });
    }
  }
  if (!prevCloseFriend && nextCloseFriend) {
    const p = await dbQueryOne<{ display_name: string; handle: string; accent_color: string }>(
      "SELECT display_name, handle, accent_color FROM personas WHERE id = $1",
      [personaId]
    );
    if (p) {
      emitRealtimeEvent(userId, "notification:push", {
        title: "Close Friends",
        body: `${p.handle} added you to their Close Friends list`,
        route: "/feed",
        accent_color: "#30D158",
        persona_id: personaId,
      });
    }
  }

  return {
    affinity: nextAffinity,
    trust: nextTrust,
    romantic_tension: nextRomantic,
    current_mood: nextMood,
    internal_thought: nextThought,
    relationship_stage: nextStage,
    persona_follows_back: nextFollowsBack,
    persona_added_close_friend: nextCloseFriend,
  };
}

/**
 * Delivers 1-4 consecutive DM bubbles + optional proximity-gated media attachment
 * with authentic human read/thinking/typing latency:
 * 1. Human "opening & reading" delay -> marks user's message `Seen` (dm:read SSE)
 * 2. Optional emoji reaction on user's message (dm:reaction SSE)
 * 3. Human thinking pause + per-character typing indicator (typing:start -> bubble -> inter-bubble pause)
 */
export async function deliverPersonaTurnBubbles(params: {
  userId: string;
  persona: PersonaRow;
  bubbles: string[];
  mediaAttachment?: MediaAttachmentDraft | null;
  reactEmoji?: string | null;
  reactTargetMessageId?: string | null;
  stateUpdate?: {
    affinity: number;
    trust: number;
    romantic_tension: number;
    current_mood: string;
    internal_thought: string;
    relationship_stage: string;
    persona_follows_back?: boolean;
    persona_added_close_friend?: boolean;
  };
  instant?: boolean;
  pushNotification?: boolean;
  incrementUnread?: boolean;
}): Promise<{ bubbleGroupId: string; messages: PersistedDmRow[] }> {
  const {
    userId,
    persona,
    bubbles,
    mediaAttachment,
    reactEmoji,
    reactTargetMessageId,
    stateUpdate,
    instant,
    pushNotification,
  } = params;
  const bubbleGroupId = crypto.randomUUID();
  const saved: PersistedDmRow[] = [];
  const { speedMultiplier } = getRuntimeConfig();
  const paceDivisor = Math.max(1, Math.min(4, Math.sqrt(speedMultiplier)));

  try {
    // Phase 1: Authentic human open/read latency before "Seen" appears!
    if (!instant) {
      const affinity = stateUpdate?.affinity ?? 0;
      const baseReadMs =
        affinity < 15
          ? 2400 + Math.random() * 2400 // strangers take noticeably longer to open a DM
          : affinity < 40
            ? 1500 + Math.random() * 1700
            : 1000 + Math.random() * 1200;
      await sleep(Math.max(700, Math.round(baseReadMs / paceDivisor)));
    }

    // Mark user's recent messages as Seen & emit dm:read!
    const seenIso = new Date().toISOString();
    await dbQuery(
      `UPDATE dm_messages
       SET read_at = $3::timestamptz
       WHERE user_id = $1 AND persona_id = $2 AND sender_type = 'user' AND read_at IS NULL`,
      [userId, persona.id, seenIso]
    );
    await dbQuery(
      `UPDATE user_persona_state
       SET dm_last_seen_at = $3::timestamptz
       WHERE user_id = $1 AND persona_id = $2`,
      [userId, persona.id, seenIso]
    );
    emitRealtimeEvent(userId, "dm:read", {
      persona_id: persona.id,
      read_at: seenIso,
    });

    // Optional persona emoji reaction on user's message
    if (reactEmoji && reactTargetMessageId) {
      if (!instant) await sleep(Math.round(550 / paceDivisor));
      await dbQuery("UPDATE dm_messages SET reaction = $2 WHERE id = $1", [
        reactTargetMessageId,
        reactEmoji.slice(0, 12),
      ]);
      emitRealtimeEvent(userId, "dm:reaction", {
        persona_id: persona.id,
        message_id: reactTargetMessageId,
        reaction: reactEmoji.slice(0, 12),
      });
    }

    // Phase 2: Natural thinking pause before starting to type
    if (!instant) {
      await sleep(Math.max(450, Math.round((700 + Math.random() * 750) / paceDivisor)));
    }

    // Phase 3: Stream bubbles at authentic human typing cadence
    for (let i = 0; i < bubbles.length; i++) {
      const text = bubbles[i].trim();
      if (!text) continue;

      if (!instant) {
        emitRealtimeEvent(userId, "typing:start", {
          persona_id: persona.id,
          activity: "typing",
        });
        const rawTypingMs = 900 + text.length * 64 + Math.random() * 600;
        const delayMs = Math.max(1100, Math.min(6200, Math.round(rawTypingMs / paceDivisor)));
        await sleep(delayMs);
      }

      const row = await dbQueryOne<PersistedDmRow>(
        `INSERT INTO dm_messages (
          user_id, persona_id, sender_type, message_type, body, media_url, media_metadata, bubble_group_id
        ) VALUES ($1, $2, 'persona', 'text', $3, NULL, '{}'::jsonb, $4)
        RETURNING *`,
        [userId, persona.id, text, bubbleGroupId]
      );

      if (row) {
        saved.push(row);
        emitRealtimeEvent(userId, "dm:bubble", {
          persona_id: persona.id,
          message: row,
          state_update: i === bubbles.length - 1 ? stateUpdate : undefined,
        });
      }

      if (!instant && i < bubbles.length - 1) {
        emitRealtimeEvent(userId, "typing:stop", { persona_id: persona.id });
        await sleep(Math.max(450, Math.round((850 + Math.random() * 900) / paceDivisor)));
      }
    }

    // Phase 4: Optional proximity-approved media attachment (photo, real neural voice note, or short video)
    if (mediaAttachment) {
      if (!instant) {
        emitRealtimeEvent(userId, "typing:start", {
          persona_id: persona.id,
          activity: mediaAttachment.type === "audio" ? "recording" : "sending_media",
        });
        const mediaWait = mediaAttachment.type === "audio" ? 2400 : 1500;
        await sleep(Math.max(700, Math.round(mediaWait / paceDivisor)));
      }

      const tier = getMediaUnlockTier(
        stateUpdate?.affinity ?? 0,
        stateUpdate?.romantic_tension ?? 0
      );
      const resolved = await resolveMediaAttachment(persona, mediaAttachment, tier);

      // Never deliver a broken audio bubble with null mediaUrl
      if (!(resolved.messageType === "audio" && !resolved.mediaUrl)) {
        const mediaRow = await dbQueryOne<PersistedDmRow>(
          `INSERT INTO dm_messages (
            user_id, persona_id, sender_type, message_type, body, media_url, media_metadata, bubble_group_id
          ) VALUES ($1, $2, 'persona', $3, $4, $5, $6::jsonb, $7)
          RETURNING *`,
          [
            userId,
            persona.id,
            resolved.messageType,
            resolved.body,
            resolved.mediaUrl,
            JSON.stringify(resolved.mediaMetadata),
            bubbleGroupId,
          ]
        );

        if (mediaRow) {
          saved.push(mediaRow);
          emitRealtimeEvent(userId, "dm:bubble", {
            persona_id: persona.id,
            message: mediaRow,
            state_update: stateUpdate,
          });
        }
      }
    }

    if (params.incrementUnread && saved.length > 0) {
      await dbQuery(
        `UPDATE user_persona_state
         SET unread_count = unread_count + 1, last_interaction_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND persona_id = $2`,
        [userId, persona.id]
      );
    }

    if (pushNotification && saved[0]) {
      const preview =
        mediaAttachment?.type === "audio"
          ? "Sent a voice note"
          : mediaAttachment?.type === "video"
            ? "Sent a video"
            : mediaAttachment?.type === "image"
              ? mediaAttachment.view_once
                ? "Sent a view-once photo"
                : "Sent a photo"
              : saved[0].body.slice(0, 90);

      emitRealtimeEvent(userId, "notification:push", {
        title: persona.display_name,
        body: preview,
        route: `/dms/${persona.id}`,
        accent_color: persona.accent_color,
        persona_id: persona.id,
      });
    }
  } finally {
    if (!instant) {
      emitRealtimeEvent(userId, "typing:stop", { persona_id: persona.id });
    }
  }

  return { bubbleGroupId, messages: saved };
}
