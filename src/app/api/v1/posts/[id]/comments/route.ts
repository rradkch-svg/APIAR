import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { scaleDelayMs } from "@/lib/config/runtime";
import { emitRealtimeEvent } from "@/lib/realtime/bus";
import { applyUserPersonaStateUpdate } from "@/lib/workers/deliver";
import { startBackgroundWorkers } from "@/lib/workers/scheduler";

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(300),
  parent_comment_id: z.string().uuid().optional().nullable(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    startBackgroundWorkers();
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const { id: postId } = await context.params;
    const json = await req.json();
    const parsed = createCommentSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Comment cannot be empty", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const post = await dbQueryOne<{
      id: string;
      author_type: "user" | "persona";
      author_persona_id: string | null;
      body: string;
    }>("SELECT id, author_type, author_persona_id, body FROM posts WHERE id = $1 AND user_id = $2", [
      postId,
      user.id,
    ]);
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const parent = parsed.data.parent_comment_id
      ? await dbQueryOne<{ id: string; author_persona_id: string | null }>(
          "SELECT id, author_persona_id FROM comments WHERE id = $1 AND post_id = $2",
          [parsed.data.parent_comment_id, postId]
        )
      : null;

    const inserted = await dbQueryOne<{ id: string; created_at: string }>(
      `INSERT INTO comments (post_id, user_id, parent_comment_id, author_type, author_persona_id, body, likes_count)
       VALUES ($1, $2, $3, 'user', NULL, $4, 0)
       RETURNING id, created_at`,
      [postId, user.id, parent?.id ?? null, parsed.data.body]
    );

    if (!inserted) {
      return NextResponse.json({ error: "Failed to save comment" }, { status: 500 });
    }

    const commentPayload = {
      id: inserted.id,
      post_id: postId,
      parent_comment_id: parent?.id ?? null,
      author_type: "user" as const,
      author_persona_id: null,
      author_name: user.display_name,
      author_handle: user.handle,
      author_avatar: user.avatar_url,
      author_accent: "#5E5CE6",
      body: parsed.data.body,
      likes_count: 0,
      relation_to_parent: null,
      created_at: inserted.created_at,
      replies: [],
    };

    emitRealtimeEvent(user.id, "feed:comment", {
      post_id: postId,
      comment: commentPayload,
    });

    // Determine which persona should notice & reply back realistically!
    const targetPersonaId = parent?.author_persona_id || post.author_persona_id;
    let replyScheduledFor: string | null = null;

    if (targetPersonaId) {
      await applyUserPersonaStateUpdate(user.id, targetPersonaId, {
        affinityDelta: 2,
      });
      replyScheduledFor = targetPersonaId;
      const delayMs = scaleDelayMs(12000 + Math.random() * 18000, 3000);
      await dbQuery(
        `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
         VALUES ($1, 'comment_reply', $2::jsonb, $3, 'pending')`,
        [
          user.id,
          JSON.stringify({
            post_id: postId,
            parent_comment_id: inserted.id,
            responder_id: targetPersonaId,
          }),
          new Date(Date.now() + delayMs).toISOString(),
        ]
      );
    }

    return NextResponse.json(
      { comment: commentPayload, reply_scheduled_for: replyScheduledFor },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/v1/posts/[id]/comments] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to post comment" },
      { status: 500 }
    );
  }
}
