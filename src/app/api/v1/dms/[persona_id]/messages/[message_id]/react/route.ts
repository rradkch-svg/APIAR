import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQueryOne } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { emitRealtimeEvent } from "@/lib/realtime/bus";

const reactSchema = z.object({
  emoji: z.string().trim().max(12).nullable(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ persona_id: string; message_id: string }> }
) {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const { persona_id, message_id } = await context.params;
    const json = await req.json();
    const parsed = reactSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid reaction" }, { status: 400 });
    }

    const updated = await dbQueryOne<{ id: string; reaction: string | null }>(
      `UPDATE dm_messages
       SET reaction = CASE WHEN reaction = $4 THEN NULL ELSE $4 END
       WHERE id = $1 AND user_id = $2 AND persona_id = $3
       RETURNING id, reaction`,
      [message_id, user.id, persona_id, parsed.data.emoji]
    );

    if (!updated) return NextResponse.json({ error: "Message not found" }, { status: 404 });

    emitRealtimeEvent(user.id, "dm:reaction", {
      persona_id,
      message_id,
      reaction: updated.reaction,
    });

    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to react to message" },
      { status: 500 }
    );
  }
}
