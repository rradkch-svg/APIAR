import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { isPersonaOnline, type ActivitySchedule } from "@/lib/personas/metadata";
import { getMediaUnlockTier } from "@/lib/media/tiers";

interface CrewPersonaRow {
  id: string;
  display_name: string;
  handle: string;
  clique: string;
  archetype: string;
  avatar_url: string | null;
  accent_color: string;
  age: number;
  bio: string;
  gossip_propensity: number;
  voice_profile: Record<string, unknown>;
  visual_anchor: string;
  activity_schedule: ActivitySchedule;
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
  last_interaction_at: string | null;
}

export async function GET() {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const [personasRes, edgeCountRes, memoriesRes, gossipRes] = await Promise.all([
      dbQuery<CrewPersonaRow>(
        `SELECT
           p.id, p.display_name, p.handle, p.clique, p.archetype, p.avatar_url,
           p.accent_color, p.age, p.bio, p.gossip_propensity, p.voice_profile,
           p.visual_anchor, p.activity_schedule,
           ups.affinity, ups.trust, ups.romantic_tension, ups.current_mood,
           ups.internal_thought, ups.relationship_stage, ups.unread_count,
           ups.user_follows, ups.persona_follows_back, ups.is_close_friend,
           ups.persona_added_close_friend, ups.dm_turns_count,
           ups.last_interaction_at
         FROM personas p
         JOIN user_persona_state ups ON ups.persona_id = p.id AND ups.user_id = $1
         WHERE p.is_active = TRUE
         ORDER BY ups.affinity DESC, p.display_name ASC`,
        [user.id]
      ),
      dbQuery<{ count: string }>("SELECT COUNT(*)::text AS count FROM persona_edges"),
      dbQuery<{
        id: string;
        persona_id: string;
        fact: string;
        category: string;
        importance: number;
        source_type: string;
        leaked_by_persona: string | null;
        created_at: string;
      }>(
        `SELECT id, persona_id, fact, category, importance, source_type, leaked_by_persona, created_at
         FROM memories
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 250`,
        [user.id]
      ),
      dbQuery<{
        id: string;
        origin_persona_id: string;
        summary: string;
        juiciness: number;
        reached_personas: string[];
        created_at: string;
      }>(
        `SELECT id, origin_persona_id, summary, juiciness, reached_personas, created_at
         FROM gossip_events
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [user.id]
      ),
    ]);

    const memoriesByPersona = new Map<string, typeof memoriesRes.rows>();
    for (const m of memoriesRes.rows) {
      const list = memoriesByPersona.get(m.persona_id) || [];
      list.push(m);
      memoriesByPersona.set(m.persona_id, list);
    }

    // Internal social graph edges remain server-side only (never exposed to the client UI)
    const crew = personasRes.rows.map((p) => ({
      ...p,
      is_online: isPersonaOnline(p.activity_schedule, user.current_slot),
      media_tier: getMediaUnlockTier(p.affinity, p.romantic_tension),
      memories: (memoriesByPersona.get(p.id) || []).slice(0, 12),
    }));

    return NextResponse.json({
      crew,
      gossip_events: gossipRes.rows,
      total_personas: crew.length,
      total_edges: Number(edgeCountRes.rows[0]?.count ?? 0),
      current_day: user.current_day,
      current_slot: user.current_slot,
    });
  } catch (err) {
    console.error("[GET /api/v1/graph/crew] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load crew" },
      { status: 500 }
    );
  }
}
