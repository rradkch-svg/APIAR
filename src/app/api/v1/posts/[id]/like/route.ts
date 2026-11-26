import { NextResponse } from "next/server";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { emitRealtimeEvent } from "@/lib/realtime/bus";
import { applyUserPersonaStateUpdate } from "@/lib/workers/deliver";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const { id } = await context.params;
    const post = await dbQueryOne<{
      id: string;
      author_type: "user" | "persona";
      author_persona_id: string | null;
      liked_by_user: boolean;
      likes_count: number;
      views_count: number;
    }>(
      `SELECT id, author_type, author_persona_id, liked_by_user, likes_count, views_count
       FROM posts WHERE id = $1 AND user_id = $2`,
      [id, user.id]
    );

    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const nextLiked = !post.liked_by_user;
    const nextCount = Math.max(0, post.likes_count + (nextLiked ? 1 : -1));

    const updated = await dbQueryOne<{
      liked_by_user: boolean;
      likes_count: number;
      views_count: number;
    }>(
      `UPDATE posts
       SET liked_by_user = $3, likes_count = $4
       WHERE id = $1 AND user_id = $2
       RETURNING liked_by_user, likes_count, views_count`,
      [id, user.id, nextLiked, nextCount]
    );

    if (nextLiked) {
      await dbQuery(
        `INSERT INTO post_likes (post_id, user_id, liker_type, liker_persona_id)
         VALUES ($1, $2, 'user', NULL)
         ON CONFLICT DO NOTHING`,
        [id, user.id]
      );
      if (post.author_type === "persona" && post.author_persona_id) {
        await applyUserPersonaStateUpdate(user.id, post.author_persona_id, {
          affinityDelta: 1,
        });
      }
    } else {
      await dbQuery(
        `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2 AND liker_type = 'user'`,
        [id, user.id]
      );
    }

    if (updated) {
      emitRealtimeEvent(user.id, "feed:likes_bump", {
        post_id: id,
        likes_count: updated.likes_count,
        views_count: updated.views_count,
      });
    }

    return NextResponse.json({
      liked: nextLiked,
      liked_by_user: nextLiked,
      likes_count: updated?.likes_count ?? nextCount,
      views_count: updated?.views_count ?? post.views_count,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to toggle like" },
      { status: 500 }
    );
  }
}
