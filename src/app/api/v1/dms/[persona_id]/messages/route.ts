import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { consumeUserEnergy, getActiveUser } from "@/lib/db/session";
import type { PersonaRow } from "@/lib/personas/metadata";
import { captionUserPostImage, generateDmTurn } from "@/lib/llm/router";
import { retrieveTopMemories } from "@/lib/llm/embeddings";
import { getMediaUnlockTier } from "@/lib/media/tiers";
import {
  applyUserPersonaStateUpdate,
  deliverPersonaTurnBubbles,
  type PersistedDmRow,
} from "@/lib/workers/deliver";
import { emitRealtimeEvent } from "@/lib/realtime/bus";
import { startBackgroundWorkers } from "@/lib/workers/scheduler";
import type { WorldEventRow } from "@/lib/workers/director";

const sendDmSchema = z.object({
  body: z.string().trim().max(1200).optional().default(""),
  message_type: z
    .enum(["text", "image", "screenshot_alert", "story_reply", "note_reply", "post_share"])
    .default("text"),
  media_url: z.string().trim().max(3_000_000).optional().nullable(),
  media_metadata: z.record(z.string(), z.unknown()).optional(),
  reply_to_message_id: z.string().uuid().optional().nullable(),
  sync: z.boolean().optional().default(false),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ persona_id: string }> }
) {
  try {
    startBackgroundWorkers();
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const { persona_id } = await context.params;
    const persona = await dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [
      persona_id,
    ]);
    if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

    const json = await req.json();
    const parsed = sendDmSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid message payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const messageType = parsed.data.message_type;
    const mediaUrl = parsed.data.media_url?.trim() || null;
    const messageBody =
      messageType === "screenshot_alert"
        ? parsed.data.body || `${user.display_name} took a screenshot of this chat!`
        : messageType === "image"
          ? parsed.data.body || "Sent a photo"
          : parsed.data.body;

    if (messageType === "text" && !messageBody) {
      return NextResponse.json({ error: "Message text cannot be empty" }, { status: 400 });
    }
    if (messageType === "image" && !mediaUrl) {
      return NextResponse.json({ error: "Image URL or upload is required" }, { status: 400 });
    }

    let energy = user.energy;
    let maxEnergy = user.max_energy;
    if (messageType === "text" || messageType === "image") {
      const energyRes = await consumeUserEnergy(user.id, 1);
      if (!energyRes.ok) {
        return NextResponse.json(
          {
            error: "Out of daily energy! Advance +24h or +6h in Settings.",
            energy: energyRes.energy,
            max_energy: energyRes.max_energy,
          },
          { status: 429 }
        );
      }
      energy = energyRes.energy;
      maxEnergy = energyRes.max_energy;
    }

    // Run Vision captioning if user sent a photo in DM!
    const imageCaption =
      messageType === "image" && mediaUrl
        ? await captionUserPostImage(mediaUrl, parsed.data.body || "")
        : null;

    const replyTarget = parsed.data.reply_to_message_id
      ? await dbQueryOne<{ id: string; body: string; sender_type: string }>(
          "SELECT id, body, sender_type FROM dm_messages WHERE id = $1 AND user_id = $2",
          [parsed.data.reply_to_message_id, user.id]
        )
      : null;

    const mergedMeta: Record<string, unknown> = {
      ...(parsed.data.media_metadata || {}),
      ...(imageCaption ? { vision_caption: imageCaption } : {}),
      ...(replyTarget
        ? { reply_preview: replyTarget.body.slice(0, 90), reply_sender: replyTarget.sender_type }
        : {}),
    };

    const userMsgRow = await dbQueryOne<PersistedDmRow>(
      `INSERT INTO dm_messages (
        user_id, persona_id, sender_type, message_type, body, media_url, media_metadata, reply_to_message_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      RETURNING *`,
      [
        user.id,
        persona.id,
        messageType === "screenshot_alert" ? "system" : "user",
        messageType,
        messageBody,
        mediaUrl,
        JSON.stringify(mergedMeta),
        replyTarget?.id ?? null,
      ]
    );

    const [stateRow, historyRes, retrievedMemories, recentPostsRes, activeHook] = await Promise.all([
      dbQueryOne<{
        affinity: number;
        trust: number;
        romantic_tension: number;
        current_mood: string;
        internal_thought: string;
        relationship_stage: string;
        user_follows: boolean;
        persona_follows_back: boolean;
        dm_turns_count: number;
      }>(
        `SELECT affinity, trust, romantic_tension, current_mood, internal_thought, relationship_stage,
                user_follows, persona_follows_back, dm_turns_count
         FROM user_persona_state
         WHERE user_id = $1 AND persona_id = $2`,
        [user.id, persona.id]
      ),
      dbQuery<{ sender_type: string; message_type: string; body: string }>(
        `SELECT sender_type, message_type, body FROM (
           SELECT sender_type, message_type, body, created_at
           FROM dm_messages
           WHERE user_id = $1 AND persona_id = $2
           ORDER BY created_at DESC
           LIMIT 15
         ) sub
         ORDER BY created_at ASC`,
        [user.id, persona.id]
      ),
      retrieveTopMemories(user.id, persona.id, `${messageBody} ${imageCaption || ""}`, 5),
      dbQuery<{ body: string; image_caption_ai: string | null; created_at: string }>(
        `SELECT body, image_caption_ai, created_at
         FROM posts
         WHERE user_id = $1 AND author_type = 'user'
         ORDER BY created_at DESC
         LIMIT 2`,
        [user.id]
      ),
      dbQueryOne<WorldEventRow>(
        `SELECT * FROM world_events
         WHERE user_id = $1 AND persona_id = $2
           AND event_type = 'emotional_hook' AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1`,
        [user.id, persona.id]
      ),
    ]);

    const currentState = stateRow || {
      affinity: 0,
      trust: 0,
      romantic_tension: 0,
      current_mood: "chill",
      internal_thought: "",
      relationship_stage: "stranger",
      user_follows: false,
      persona_follows_back: false,
      dm_turns_count: 0,
    };

    const { output, providerUsed, mediaBlockedReason } = await generateDmTurn({
      persona,
      user,
      state: currentState,
      history: historyRes.rows,
      userMessage: messageBody,
      messageType,
      imageCaption,
      replyQuote: replyTarget?.body ?? null,
      retrievedMemories,
      recentUserPosts: recentPostsRes.rows,
      activeEmotionalHook: activeHook
        ? { title: activeHook.title, description: activeHook.description }
        : null,
    });

    let hookBonusAffinity = 0;
    let hookBonusTrust = 0;
    let resolvedHookTitle: string | null = null;
    if (activeHook && (messageType === "text" || messageType === "image")) {
      await dbQuery("UPDATE world_events SET status = 'completed' WHERE id = $1", [activeHook.id]);
      hookBonusAffinity = Math.max(4, Math.round(activeHook.reward_affinity * 0.5));
      hookBonusTrust = 10;
      resolvedHookTitle = activeHook.title;
      emitRealtimeEvent(user.id, "world:update", { reason: "emotional_hook_completed" });
    }

    const updatedState = await applyUserPersonaStateUpdate(user.id, persona.id, {
      affinityDelta: output.affinity_delta + hookBonusAffinity,
      trustDelta: (output.affinity_delta > 0 ? 2 : output.affinity_delta < -2 ? -2 : 0) + hookBonusTrust,
      romanticDelta: output.romantic_delta,
      newMood: output.new_mood,
      internalThought: output.internal_thought,
      incrementDmTurns: messageType !== "screenshot_alert",
    });

    if (messageType !== "screenshot_alert") {
      await dbQuery(
        `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
         VALUES ($1, 'memory_extract', $2::jsonb, NOW(), 'pending')`,
        [
          user.id,
          JSON.stringify({
            persona_id: persona.id,
            source_type: "direct",
            recent_messages: [imageCaption ? `${messageBody} [photo: ${imageCaption}]` : messageBody],
          }),
        ]
      );
    }

    let gossipScheduled = false;
    if (output.gossip_candidate && output.gossip_candidate.juiciness >= 6) {
      gossipScheduled = true;
      await dbQuery(
        `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
         VALUES ($1, 'gossip_leak', $2::jsonb, NOW(), 'pending')`,
        [
          user.id,
          JSON.stringify({
            origin_persona_id: persona.id,
            summary: output.gossip_candidate.summary,
            juiciness: output.gossip_candidate.juiciness,
          }),
        ]
      );
    }

    const deliveryPromise = deliverPersonaTurnBubbles({
      userId: user.id,
      persona,
      bubbles: output.bubbles,
      mediaAttachment: output.media_attachment,
      reactEmoji: output.react_emoji ?? null,
      reactTargetMessageId: userMsgRow?.id ?? null,
      stateUpdate: updatedState,
      instant: parsed.data.sync,
      pushNotification: false,
    });

    if (parsed.data.sync) {
      const delivered = await deliveryPromise;
      return NextResponse.json({
        user_message: userMsgRow,
        reply_messages: delivered.messages,
        bubble_group_id: delivered.bubbleGroupId,
        state: updatedState,
        media_tier: getMediaUnlockTier(updatedState.affinity, updatedState.romantic_tension),
        media_blocked_reason: mediaBlockedReason,
        gossip_scheduled: gossipScheduled,
        gossip_candidate: output.gossip_candidate ?? null,
        resolved_hook: resolvedHookTitle,
        provider_used: providerUsed,
        energy,
        max_energy: maxEnergy,
      });
    }

    void deliveryPromise.catch((err) => {
      console.error("[DM async delivery] error:", err);
    });

    return NextResponse.json(
      {
        user_message: userMsgRow,
        streaming_via_sse: true,
        expected_bubbles: output.bubbles.length + (output.media_attachment ? 1 : 0),
        state: updatedState,
        media_tier: getMediaUnlockTier(updatedState.affinity, updatedState.romantic_tension),
        media_blocked_reason: mediaBlockedReason,
        gossip_scheduled: gossipScheduled,
        gossip_candidate: output.gossip_candidate ?? null,
        resolved_hook: resolvedHookTitle,
        provider_used: providerUsed,
        energy,
        max_energy: maxEnergy,
      },
      { status: 202 }
    );
  } catch (err) {
    console.error("[POST /api/v1/dms/[persona_id]/messages] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send message" },
      { status: 500 }
    );
  }
}
