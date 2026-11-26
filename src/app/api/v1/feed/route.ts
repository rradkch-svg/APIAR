import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { maybeRunLazyFeedGeneration } from "@/lib/workers/lazy-feed";
import { startBackgroundWorkers } from "@/lib/workers/scheduler";

interface PostRow {
  id: string;
  user_id: string;
  author_type: "user" | "persona";
  author_persona_id: string | null;
  body: string;
  image_url: string | null;
  media_urls: string[] | null;
  location_tag: string | null;
  audience: string;
  liked_by_user: boolean;
  saved_by_user: boolean;
  user_follows_author: boolean;
  image_caption_ai: string | null;
  likes_count: number;
  views_count: number;
  created_at: string;
  persona_name: string | null;
  persona_handle: string | null;
  persona_avatar: string | null;
  persona_accent: string | null;
  persona_clique: string | null;
}

interface CommentRow {
  id: string;
  post_id: string;
  parent_comment_id: string | null;
  author_type: "user" | "persona";
  author_persona_id: string | null;
  body: string;
  likes_count: number;
  created_at: string;
  persona_name: string | null;
  persona_handle: string | null;
  persona_avatar: string | null;
  persona_accent: string | null;
  relation_to_parent: string | null;
}

export async function GET(req: Request) {
  try {
    startBackgroundWorkers();
    const user = await getActiveUser();
    if (!user) {
      return NextResponse.json({ error: "Onboarding required" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, Math.max(5, Number(searchParams.get("limit") || "20")));
    const offset = Math.max(0, Number(searchParams.get("offset") || "0"));
    const authorFilter = searchParams.get("author");
    const personaFilter = searchParams.get("persona_id");
    const savedOnly = searchParams.get("saved") === "true";

    const lazyGenerated =
      offset === 0 && !authorFilter && !savedOnly && !personaFilter
        ? await maybeRunLazyFeedGeneration(user)
        : false;

    let sql = `
      SELECT
        p.*,
        (sp.post_id IS NOT NULL) AS saved_by_user,
        COALESCE(ups.user_follows, FALSE) AS user_follows_author,
        per.display_name AS persona_name,
        per.handle AS persona_handle,
        per.avatar_url AS persona_avatar,
        per.accent_color AS persona_accent,
        per.clique AS persona_clique
      FROM posts p
      LEFT JOIN personas per ON per.id = p.author_persona_id
      LEFT JOIN saved_posts sp ON sp.post_id = p.id AND sp.user_id = $1
      LEFT JOIN user_persona_state ups ON ups.persona_id = p.author_persona_id AND ups.user_id = $1
      WHERE p.user_id = $1`;

    const queryParams: unknown[] = [user.id];

    if (savedOnly) {
      sql += ` AND sp.post_id IS NOT NULL`;
    } else if (authorFilter === "user") {
      sql += ` AND p.author_type = 'user'`;
    } else if (personaFilter) {
      queryParams.push(personaFilter);
      sql += ` AND p.author_persona_id = $${queryParams.length}`;
    }

    queryParams.push(limit, offset);
    sql += ` ORDER BY ${savedOnly ? "sp.created_at DESC" : "p.created_at DESC"} LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;

    const postsRes = await dbQuery<PostRow>(sql, queryParams);
    const postIds = postsRes.rows.map((p) => p.id);
    const commentsByPost = new Map<string, CommentRow[]>();
    const likersByPost = new Map<string, string[]>();

    if (postIds.length > 0) {
      const [commentsRes, likesRes] = await Promise.all([
        dbQuery<CommentRow>(
          `SELECT
             c.id, c.post_id, c.parent_comment_id, c.author_type, c.author_persona_id,
             c.body, c.likes_count, c.created_at,
             per.display_name AS persona_name,
             per.handle AS persona_handle,
             per.avatar_url AS persona_avatar,
             per.accent_color AS persona_accent,
             pe.relation_type AS relation_to_parent
           FROM comments c
           LEFT JOIN personas per ON per.id = c.author_persona_id
           LEFT JOIN comments pc ON pc.id = c.parent_comment_id
           LEFT JOIN persona_edges pe
             ON pe.source_id = c.author_persona_id AND pe.target_id = pc.author_persona_id
           WHERE c.post_id = ANY($1::uuid[])
           ORDER BY c.created_at ASC`,
          [postIds]
        ),
        dbQuery<{ post_id: string; handle: string }>(
          `SELECT pl.post_id, per.handle
           FROM post_likes pl
           JOIN personas per ON per.id = pl.liker_persona_id
           WHERE pl.post_id = ANY($1::uuid[]) AND pl.liker_type = 'persona'
           ORDER BY pl.created_at DESC`,
          [postIds]
        ),
      ]);

      for (const c of commentsRes.rows) {
        const list = commentsByPost.get(c.post_id) || [];
        list.push(c);
        commentsByPost.set(c.post_id, list);
      }

      for (const l of likesRes.rows) {
        const list = likersByPost.get(l.post_id) || [];
        if (list.length < 3) list.push(l.handle.replace(/^@/, ""));
        likersByPost.set(l.post_id, list);
      }
    }

    const posts = postsRes.rows.map((p) => {
      const rawComments = commentsByPost.get(p.id) || [];
      const formatted = rawComments.map((c) => ({
        id: c.id,
        post_id: c.post_id,
        parent_comment_id: c.parent_comment_id,
        author_type: c.author_type,
        author_persona_id: c.author_persona_id,
        author_name:
          c.author_type === "user" ? user.display_name : c.persona_name || "Campus Student",
        author_handle: c.author_type === "user" ? user.handle : c.persona_handle || "@campus",
        author_avatar: c.author_type === "user" ? user.avatar_url : c.persona_avatar,
        author_accent: c.author_type === "user" ? "#5E5CE6" : c.persona_accent || "#5E5CE6",
        body: c.body,
        likes_count: c.likes_count,
        relation_to_parent: c.relation_to_parent,
        created_at: c.created_at,
        replies: [] as unknown[],
      }));

      const byId = new Map(formatted.map((c) => [c.id, c]));
      const roots: typeof formatted = [];
      for (const c of formatted) {
        if (c.parent_comment_id && byId.has(c.parent_comment_id)) {
          byId.get(c.parent_comment_id)!.replies.push(c);
        } else {
          roots.push(c);
        }
      }

      const mediaList =
        Array.isArray(p.media_urls) && p.media_urls.length > 0
          ? p.media_urls
          : p.image_url
            ? [p.image_url]
            : [];

      return {
        id: p.id,
        author_type: p.author_type,
        author_persona_id: p.author_persona_id,
        author_name:
          p.author_type === "user" ? user.display_name : p.persona_name || "Campus Student",
        author_handle: p.author_type === "user" ? user.handle : p.persona_handle || "@campus",
        author_avatar: p.author_type === "user" ? user.avatar_url : p.persona_avatar,
        author_accent: p.author_type === "user" ? "#5E5CE6" : p.persona_accent || "#5E5CE6",
        author_clique: p.author_type === "user" ? user.context_tag : p.persona_clique,
        body: p.body,
        image_url: mediaList[0] || p.image_url,
        media_urls: mediaList,
        location_tag: p.location_tag,
        audience: p.audience || "campus",
        liked_by_user: Boolean(p.liked_by_user),
        saved_by_user: Boolean(p.saved_by_user),
        user_follows_author: Boolean(p.user_follows_author),
        liked_by_handles: likersByPost.get(p.id) || [],
        image_caption_ai: p.image_caption_ai,
        likes_count: p.likes_count,
        views_count: p.views_count,
        created_at: p.created_at,
        comments: roots,
      };
    });

    return NextResponse.json({
      posts,
      lazy_generated: lazyGenerated,
      current_day: user.current_day,
      current_slot: user.current_slot,
    });
  } catch (err) {
    console.error("[GET /api/v1/feed] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load feed" },
      { status: 500 }
    );
  }
}
