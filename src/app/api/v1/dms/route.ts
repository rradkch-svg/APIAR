import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { isPersonaOnline, type ActivitySchedule } from "@/lib/personas/metadata";
import { getMediaUnlockTier } from "@/lib/media/tiers";

interface InboxRow {
  persona_id: string;
  display_name: string;
  handle: string;
  clique: string;
  archetype: string;
  avatar_url: string | null;
  accent_color: string;
  activity_schedule: ActivitySchedule;
  affinity: number;
  trust: number;
  romantic_tension: number;
  current_mood: string;
  internal_thought: string;
  relationship_stage: string;
  unread_count: number;
  last_interaction_at: string | null;
  last_message_body: string | null;
  last_message_type: string | null;
  last_message_sender: string | null;
  last_message_at: string | null;
  has_pending_invite: boolean;
  has_active_hook: boolean;
}

export async function GET() {
  try {
    const user = await getActiveUser();
    if (!user) {
      return NextResponse.json({ error: "Onboarding required" }, { status: 401 });
    }

    const res = await dbQuery<InboxRow>(
      `SELECT
         p.id AS persona_id,
         p.display_name,
         p.handle,
         p.clique,
         p.archetype,
         p.avatar_url,
         p.accent_color,
         p.activity_schedule,
         ups.affinity,
         ups.trust,
         ups.romantic_tension,
         ups.current_mood,
         ups.internal_thought,
         ups.relationship_stage,
         ups.unread_count,
         ups.last_interaction_at,
         lm.body AS last_message_body,
         lm.message_type AS last_message_type,
         lm.sender_type AS last_message_sender,
         lm.created_at AS last_message_at,
         EXISTS (
           SELECT 1 FROM world_events we
           WHERE we.user_id = $1 AND we.persona_id = p.id
             AND we.event_type = 'invite' AND we.status = 'pending'
         ) AS has_pending_invite,
         EXISTS (
           SELECT 1 FROM world_events we
           WHERE we.user_id = $1 AND we.persona_id = p.id
             AND we.event_type = 'emotional_hook' AND we.status = 'pending'
         ) AS has_active_hook
       FROM personas p
       JOIN user_persona_state ups ON ups.persona_id = p.id AND ups.user_id = $1
       LEFT JOIN LATERAL (
         SELECT body, message_type, sender_type, created_at
         FROM dm_messages
         WHERE user_id = $1 AND persona_id = p.id
         ORDER BY created_at DESC
         LIMIT 1
       ) lm ON TRUE
       WHERE p.is_active = TRUE
       ORDER BY
         (lm.created_at IS NULL) ASC,
         lm.created_at DESC NULLS LAST,
         ups.affinity DESC`,
      [user.id]
    );

    const threads = res.rows.map((r) => ({
      ...r,
      is_online: isPersonaOnline(r.activity_schedule, user.current_slot),
      media_tier: getMediaUnlockTier(r.affinity, r.romantic_tension),
    }));

    return NextResponse.json({
      threads,
      current_day: user.current_day,
      current_slot: user.current_slot,
    });
  } catch (err) {
    console.error("[GET /api/v1/dms] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load DMs" },
      { status: 500 }
    );
  }
}
