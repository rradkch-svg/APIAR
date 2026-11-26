import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { TIME_SLOT_META, type TimeSlot } from "@/lib/personas/metadata";

interface WorldEventWithPersona {
  id: string;
  user_id: string;
  persona_id: string;
  event_type: "spontaneous_ping" | "emotional_hook" | "invite";
  title: string;
  description: string;
  scheduled_day: number;
  scheduled_slot: TimeSlot;
  status: string;
  reward_affinity: number;
  penalty_affinity: number;
  conflict_group: string | null;
  dm_message_id: string | null;
  created_at: string;
  persona_name: string;
  persona_handle: string;
  persona_avatar: string | null;
  persona_accent: string;
}

export async function GET() {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const res = await dbQuery<WorldEventWithPersona>(
      `SELECT
         we.*,
         p.display_name AS persona_name,
         p.handle AS persona_handle,
         p.avatar_url AS persona_avatar,
         p.accent_color AS persona_accent
       FROM world_events we
       JOIN personas p ON p.id = we.persona_id
       WHERE we.user_id = $1
       ORDER BY
         CASE WHEN we.status IN ('pending', 'accepted') THEN 0 ELSE 1 END,
         we.scheduled_day ASC,
         we.created_at DESC
       LIMIT 30`,
      [user.id]
    );

    // Annotate overlapping schedule conflict slots (2+ pending/accepted invites in same day+slot)
    const slotCounts = new Map<string, number>();
    for (const ev of res.rows) {
      if (ev.event_type === "invite" && (ev.status === "pending" || ev.status === "accepted")) {
        const key = `${ev.scheduled_day}:${ev.scheduled_slot}`;
        slotCounts.set(key, (slotCounts.get(key) || 0) + 1);
      }
    }

    const events = res.rows.map((ev) => {
      const key = `${ev.scheduled_day}:${ev.scheduled_slot}`;
      return {
        ...ev,
        slot_label: TIME_SLOT_META[ev.scheduled_slot]?.label || ev.scheduled_slot,
        slot_emoji: TIME_SLOT_META[ev.scheduled_slot]?.emoji || "🗓️",
        has_conflict:
          ev.event_type === "invite" &&
          (ev.status === "pending" || ev.status === "accepted") &&
          (slotCounts.get(key) || 0) > 1,
      };
    });

    return NextResponse.json({
      events,
      current_day: user.current_day,
      current_slot: user.current_slot,
      slot_meta: TIME_SLOT_META[user.current_slot],
    });
  } catch (err) {
    console.error("[GET /api/v1/world-events] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load schedule" },
      { status: 500 }
    );
  }
}
