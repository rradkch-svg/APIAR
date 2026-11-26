import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveUser } from "@/lib/db/session";
import { simulateCampusTime, startBackgroundWorkers } from "@/lib/workers/scheduler";
import { TIME_SLOT_META } from "@/lib/personas/metadata";

const simulateSchema = z
  .object({
    mode: z.enum(["day", "slot"]).optional().default("day"),
  })
  .optional();

export async function POST(req: Request) {
  try {
    startBackgroundWorkers();
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    let mode: "day" | "slot" = "day";
    try {
      const text = await req.text();
      if (text.trim()) {
        const parsed = simulateSchema.parse(JSON.parse(text));
        if (parsed?.mode) mode = parsed.mode;
      }
    } catch {
      // Allow empty POST body -> defaults to +24h ("day") per 06_api_and_workers.yaml
    }

    const result = await simulateCampusTime(user.id, mode);

    return NextResponse.json({
      mode,
      user: result.user,
      slot_meta: TIME_SLOT_META[result.user.current_slot],
      flushed_jobs: result.flushedJobs,
      completed_invites: result.completedInvites,
      expired_events: result.expiredEvents,
      created_posts: result.createdPosts,
      director_events: result.directorEvents,
    });
  } catch (err) {
    console.error("[POST /api/v1/dev/simulate-time] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to simulate time" },
      { status: 500 }
    );
  }
}
