import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveUser } from "@/lib/db/session";
import { respondToWorldEvent } from "@/lib/workers/director";

const respondSchema = z.object({
  action: z.enum(["accept", "decline"]),
  confirm_flake: z.boolean().optional().default(false),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const { id } = await context.params;
    const json = await req.json();
    const parsed = respondSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid action", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await respondToWorldEvent({
      user,
      eventId: id,
      action: parsed.data.action,
      confirmFlake: parsed.data.confirm_flake,
    });

    if (!result.ok && result.conflict) {
      return NextResponse.json(
        {
          conflict: true,
          message: `You already have plans with ${result.existingPersona.display_name} (${result.existingEvent.title}) at this time.`,
          existing_event: result.existingEvent,
          existing_persona: result.existingPersona,
          new_event: result.newEvent,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/v1/world-events/[id]/respond] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to respond to invite" },
      { status: 500 }
    );
  }
}
