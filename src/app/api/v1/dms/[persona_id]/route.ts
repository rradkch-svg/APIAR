import { NextResponse } from "next/server";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { isPersonaOnline, type PersonaRow } from "@/lib/personas/metadata";
import { getMediaUnlockTier } from "@/lib/media/tiers";
import type { PersistedDmRow } from "@/lib/workers/deliver";
import type { WorldEventRow } from "@/lib/workers/director";

export async function GET(
  req: Request,
  context: { params: Promise<{ persona_id: string }> }
) {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const { persona_id } = await context.params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(10, Number(searchParams.get("limit") || "50")));

    const persona = await dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [
      persona_id,
    ]);
    if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

    const state = await dbQueryOne<{
      affinity: number;
      trust: number;
      romantic_tension: number;
      current_mood: string;
      internal_thought: string;
      relationship_stage: string;
      unread_count: number;
      user_follows: boolean;
      persona_follows_back: boolean;
      is_close_friend: boolean;
      persona_added_close_friend: boolean;
      dm_turns_count: number;
      dm_last_seen_at: string | null;
      last_interaction_at: string | null;
    }>(
      `UPDATE user_persona_state
       SET unread_count = 0, updated_at = NOW()
       WHERE user_id = $1 AND persona_id = $2
       RETURNING affinity, trust, romantic_tension, current_mood, internal_thought,
                 relationship_stage, unread_count, user_follows, persona_follows_back,
                 is_close_friend, persona_added_close_friend, dm_turns_count,
                 dm_last_seen_at, last_interaction_at`,
      [user.id, persona_id]
    );

    const [messagesRes, worldEventsRes, memoriesRes] = await Promise.all([
      dbQuery<PersistedDmRow>(
        `SELECT * FROM (
           SELECT * FROM dm_messages
           WHERE user_id = $1 AND persona_id = $2
           ORDER BY created_at DESC
           LIMIT $3
         ) sub
         ORDER BY created_at ASC`,
        [user.id, persona_id, limit]
      ),
      dbQuery<WorldEventRow>(
        `SELECT * FROM world_events
         WHERE user_id = $1 AND persona_id = $2
         ORDER BY created_at DESC
         LIMIT 10`,
        [user.id, persona_id]
      ),
      dbQuery<{
        id: string;
        fact: string;
        category: string;
        importance: number;
        source_type: string;
        leaked_by_persona: string | null;
        created_at: string;
      }>(
        `SELECT id, fact, category, importance, source_type, leaked_by_persona, created_at
         FROM memories
         WHERE user_id = $1 AND persona_id = $2
         ORDER BY created_at DESC
         LIMIT 12`,
        [user.id, persona_id]
      ),
    ]);

    const currentState = state || {
      affinity: 0,
      trust: 0,
      romantic_tension: 0,
      current_mood: "chill",
      internal_thought: "",
      relationship_stage: "stranger",
      unread_count: 0,
      user_follows: false,
      persona_follows_back: false,
      is_close_friend: false,
      persona_added_close_friend: false,
      dm_turns_count: 0,
      dm_last_seen_at: null,
      last_interaction_at: null,
    };

    return NextResponse.json({
      persona: {
        id: persona.id,
        display_name: persona.display_name,
        handle: persona.handle,
        clique: persona.clique,
        archetype: persona.archetype,
        avatar_url: persona.avatar_url,
        accent_color: persona.accent_color,
        age: persona.age,
        bio: persona.bio,
        voice_profile: persona.voice_profile,
        visual_anchor: persona.visual_anchor,
        typing_style: persona.typing_style,
        is_online: isPersonaOnline(persona.activity_schedule, user.current_slot),
      },
      state: currentState,
      media_tier: getMediaUnlockTier(currentState.affinity, currentState.romantic_tension),
      messages: messagesRes.rows,
      world_events: worldEventsRes.rows,
      memories: memoriesRes.rows,
      current_day: user.current_day,
      current_slot: user.current_slot,
    });
  } catch (err) {
    console.error("[GET /api/v1/dms/[persona_id]] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load thread" },
      { status: 500 }
    );
  }
}
