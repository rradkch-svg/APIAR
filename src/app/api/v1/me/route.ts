import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQueryOne, getDbDriverType } from "@/lib/db/client";
import { getActiveUser, type UserRow } from "@/lib/db/session";
import { getEffectiveLlmMode, getRuntimeConfig } from "@/lib/config/runtime";
import { TIME_SLOT_META } from "@/lib/personas/metadata";
import { startBackgroundWorkers } from "@/lib/workers/scheduler";

const updateProfileSchema = z.object({
  display_name: z.string().trim().min(2).max(80).optional(),
  bio: z.string().trim().max(240).optional(),
  context_tag: z.string().trim().min(2).max(40).optional(),
  avatar_url: z.string().trim().max(2_000_000).nullable().optional(),
});

export async function PATCH(req: Request) {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const json = await req.json();
    const parsed = updateProfileSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid profile fields", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updated = await dbQueryOne<UserRow>(
      `UPDATE users
       SET display_name = COALESCE($2, display_name),
           bio = COALESCE($3, bio),
           context_tag = COALESCE($4, context_tag),
           avatar_url = CASE WHEN $5::boolean THEN $6 ELSE avatar_url END,
           last_active_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        user.id,
        parsed.data.display_name ?? null,
        parsed.data.bio ?? null,
        parsed.data.context_tag ?? null,
        parsed.data.avatar_url !== undefined,
        parsed.data.avatar_url ?? null,
      ]
    );

    return NextResponse.json({ user: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update profile" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    startBackgroundWorkers();
    const user = await getActiveUser();
    const llm = getEffectiveLlmMode();
    const cfg = getRuntimeConfig();

    if (!user) {
      return NextResponse.json({
        user: null,
        needs_onboarding: true,
        runtime: {
          llm_mode: llm.mode,
          llm_provider: llm.provider,
          roleplay_model: llm.roleplayModel,
          fast_model: llm.fastModel,
          embedding_model: llm.embeddingModel,
          image_mode: llm.imageMode,
          tts_mode: llm.ttsMode,
          llm_base_url: cfg.llmBaseUrl,
          db_driver: getDbDriverType(),
          speed_multiplier: cfg.speedMultiplier,
        },
      });
    }

    const [unreadRow, gossipCountRow, pendingInvitesRow, followStats, postsRow, savedRow] =
      await Promise.all([
        dbQueryOne<{ total: string }>(
          "SELECT COALESCE(SUM(unread_count), 0)::text AS total FROM user_persona_state WHERE user_id = $1",
          [user.id]
        ),
        dbQueryOne<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM gossip_events WHERE user_id = $1",
          [user.id]
        ),
        dbQueryOne<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM world_events
           WHERE user_id = $1 AND status IN ('pending', 'accepted') AND event_type IN ('invite', 'emotional_hook')`,
          [user.id]
        ),
        dbQueryOne<{ followers: string; following: string; close_friends: string }>(
          `SELECT
             COUNT(*) FILTER (WHERE persona_follows_back = TRUE)::text AS followers,
             COUNT(*) FILTER (WHERE user_follows = TRUE)::text AS following,
             COUNT(*) FILTER (WHERE is_close_friend = TRUE)::text AS close_friends
           FROM user_persona_state
           WHERE user_id = $1`,
          [user.id]
        ),
        dbQueryOne<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM posts WHERE user_id = $1 AND author_type = 'user'",
          [user.id]
        ),
        dbQueryOne<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM saved_posts WHERE user_id = $1",
          [user.id]
        ),
      ]);

    return NextResponse.json({
      user,
      needs_onboarding: false,
      followers_count: Number(followStats?.followers ?? 0),
      following_count: Number(followStats?.following ?? 0),
      close_friends_count: Number(followStats?.close_friends ?? 0),
      posts_count: Number(postsRow?.count ?? 0),
      saved_count: Number(savedRow?.count ?? 0),
      unread_total: Number(unreadRow?.total ?? 0),
      gossip_events_count: Number(gossipCountRow?.count ?? 0),
      active_world_events_count: Number(pendingInvitesRow?.count ?? 0),
      slot_meta: TIME_SLOT_META[user.current_slot],
      runtime: {
        llm_mode: llm.mode,
        llm_provider: llm.provider,
        roleplay_model: llm.roleplayModel,
        fast_model: llm.fastModel,
        embedding_model: llm.embeddingModel,
        image_mode: llm.imageMode,
        tts_mode: llm.ttsMode,
        llm_base_url: cfg.llmBaseUrl,
        has_api_key: llm.hasKey,
        db_driver: getDbDriverType(),
        speed_multiplier: cfg.speedMultiplier,
      },
    });
  } catch (err) {
    console.error("[GET /api/v1/me] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load profile" },
      { status: 500 }
    );
  }
}
