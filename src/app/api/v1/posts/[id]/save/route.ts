import { NextResponse } from "next/server";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const { id: postId } = await context.params;
    const post = await dbQueryOne<{ id: string }>(
      "SELECT id FROM posts WHERE id = $1 AND user_id = $2",
      [postId, user.id]
    );
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const existing = await dbQueryOne<{ post_id: string }>(
      "SELECT post_id FROM saved_posts WHERE user_id = $1 AND post_id = $2",
      [user.id, postId]
    );

    if (existing) {
      await dbQuery("DELETE FROM saved_posts WHERE user_id = $1 AND post_id = $2", [
        user.id,
        postId,
      ]);
      return NextResponse.json({ saved: false, post_id: postId });
    }

    await dbQuery(
      "INSERT INTO saved_posts (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [user.id, postId]
    );
    return NextResponse.json({ saved: true, post_id: postId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to toggle save" },
      { status: 500 }
    );
  }
}
