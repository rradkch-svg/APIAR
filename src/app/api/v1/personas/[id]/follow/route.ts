import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { scaleDelayMs } from "@/lib/config/runtime";
import { startBackgroundWorkers } from "@/lib/workers/scheduler";

const followActionSchema = z.object({
  action: z.enum(["toggle_follow", "toggle_close_friend"]).default("toggle_follow"),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    startBackgroundWorkers();
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const { id: personaId } = await context.params;
    const json = await req.json().catch(() => ({}));
    const parsed = followActionSchema.safeParse(json);
    const action = parsed.success ? parsed.data.action : "toggle_follow";

    const current = await dbQueryOne<{
      affinity: number;
      user_follows: boolean;
      persona_follows_back: boolean;
      is_close_friend: boolean;
    }>(
      `SELECT affinity, user_follows, persona_follows_back, is_close_friend
       FROM user_persona_state
       WHERE user_id = $1 AND persona_id = $2`,
      [user.id, personaId]
    );

    if (!current) {
      return NextResponse.json({ error: "Persona not found" }, { status: 404 });
    }

    if (action === "toggle_close_friend") {
      if (!current.is_close_friend && current.affinity < 25) {
        return NextResponse.json(
          { error: "Get to know them a little first (Affinity 25+) to add to Close Friends." },
          { status: 400 }
        );
      }
      const nextCf = !current.is_close_friend;
      await dbQuery(
        `UPDATE user_persona_state SET is_close_friend = $3, updated_at = NOW()
         WHERE user_id = $1 AND persona_id = $2`,
        [user.id, personaId, nextCf]
      );
      return NextResponse.json({
        persona_id: personaId,
        user_follows: current.user_follows,
        persona_follows_back: current.persona_follows_back,
        is_close_friend: nextCf,
      });
    }

    const nextFollows = !current.user_follows;
    await dbQuery(
      `UPDATE user_persona_state
       SET user_follows = $3,
           affinity = CASE WHEN $3 THEN LEAST(100, affinity + 2) ELSE GREATEST(0, affinity - 3) END,
           updated_at = NOW()
       WHERE user_id = $1 AND persona_id = $2`,
      [user.id, personaId, nextFollows]
    );

    // Schedule organic follow-back evaluation after realistic delay!
    if (nextFollows && !current.persona_follows_back) {
      const delayMs = scaleDelayMs(20000 + Math.random() * 45000, 4500);
      await dbQuery(
        `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
         VALUES ($1, 'follow_decision', $2::jsonb, $3, 'pending')`,
        [user.id, JSON.stringify({ persona_id: personaId }), new Date(Date.now() + delayMs).toISOString()]
      );
    }

    return NextResponse.json({
      persona_id: personaId,
      user_follows: nextFollows,
      persona_follows_back: current.persona_follows_back,
      is_close_friend: current.is_close_friend,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update follow state" },
      { status: 500 }
    );
  }
}
