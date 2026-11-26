import { NextResponse } from "next/server";
import { dbQueryOne } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";

export async function POST(
  _req: Request,
  context: { params: Promise<{ persona_id: string; message_id: string }> }
) {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const { persona_id, message_id } = await context.params;
    const viewedAt = new Date().toISOString();

    const updated = await dbQueryOne<{ id: string; media_metadata: Record<string, unknown> }>(
      `UPDATE dm_messages
       SET media_metadata = jsonb_set(COALESCE(media_metadata, '{}'::jsonb), '{viewed_at}', to_jsonb($4::text))
       WHERE id = $1 AND user_id = $2 AND persona_id = $3
       RETURNING id, media_metadata`,
      [message_id, user.id, persona_id, viewedAt]
    );

    if (!updated) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: updated.id,
      viewed_at: viewedAt,
      media_metadata: updated.media_metadata,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to mark view-once opened" },
      { status: 500 }
    );
  }
}
