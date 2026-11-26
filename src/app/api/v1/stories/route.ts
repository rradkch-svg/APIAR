import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { refreshCampusStoriesAndNotes } from "@/lib/workers/lazy-feed";

const createStorySchema = z.object({
  media_url: z.string().trim().min(1).max(3_000_000),
  caption: z.string().trim().max(140).optional().default(""),
  audience: z.enum(["campus", "close_friends"]).optional().default("campus"),
});

interface StoryRow {
  id: string;
  author_type: "user" | "persona";
  author_persona_id: string | null;
  media_url: string;
  caption: string;
  audience: string;
  viewed_by_user: boolean;
  liked_by_user: boolean;
  expires_at: string;
  created_at: string;
  persona_name: string | null;
  persona_handle: string | null;
  persona_avatar: string | null;
  persona_added_close_friend: boolean | null;
}

export async function GET() {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    await refreshCampusStoriesAndNotes(user, 6);

    const res = await dbQuery<StoryRow>(
      `SELECT
         s.id, s.author_type, s.author_persona_id, s.media_url, s.caption, s.audience,
         s.viewed_by_user, s.liked_by_user, s.expires_at, s.created_at,
         p.display_name AS persona_name,
         p.handle AS persona_handle,
         p.avatar_url AS persona_avatar,
         ups.persona_added_close_friend
       FROM stories s
       LEFT JOIN personas p ON p.id = s.author_persona_id
       LEFT JOIN user_persona_state ups ON ups.persona_id = s.author_persona_id AND ups.user_id = $1
       WHERE s.user_id = $1
         AND s.expires_at > NOW()
         AND (
           s.author_type = 'user'
           OR s.audience = 'campus'
           OR COALESCE(ups.persona_added_close_friend, FALSE) = TRUE
         )
       ORDER BY s.created_at DESC`,
      [user.id]
    );

    // Group slides by author (user first, then unseen stories, then seen stories)
    const groupsMap = new Map<
      string,
      {
        author_key: string;
        author_type: "user" | "persona";
        author_persona_id: string | null;
        author_name: string;
        author_handle: string;
        author_avatar: string | null;
        has_unseen: boolean;
        is_close_friends: boolean;
        slides: Array<{
          id: string;
          media_url: string;
          caption: string;
          audience: string;
          viewed_by_user: boolean;
          liked_by_user: boolean;
          created_at: string;
        }>;
      }
    >();

    for (const row of res.rows) {
      const key = row.author_type === "user" ? "user" : row.author_persona_id || row.id;
      let group = groupsMap.get(key);
      if (!group) {
        group = {
          author_key: key,
          author_type: row.author_type,
          author_persona_id: row.author_persona_id,
          author_name:
            row.author_type === "user" ? user.display_name : row.persona_name || "Campus Student",
          author_handle:
            row.author_type === "user"
              ? user.handle.replace(/^@/, "")
              : (row.persona_handle || "campus").replace(/^@/, ""),
          author_avatar: row.author_type === "user" ? user.avatar_url : row.persona_avatar,
          has_unseen: false,
          is_close_friends: false,
          slides: [],
        };
        groupsMap.set(key, group);
      }
      if (!row.viewed_by_user && row.author_type === "persona") group.has_unseen = true;
      if (row.audience === "close_friends") group.is_close_friends = true;
      group.slides.push({
        id: row.id,
        media_url: row.media_url,
        caption: row.caption,
        audience: row.audience,
        viewed_by_user: Boolean(row.viewed_by_user),
        liked_by_user: Boolean(row.liked_by_user),
        created_at: row.created_at,
      });
    }

    const groups = Array.from(groupsMap.values()).sort((a, b) => {
      if (a.author_type === "user") return -1;
      if (b.author_type === "user") return 1;
      if (a.has_unseen !== b.has_unseen) return a.has_unseen ? -1 : 1;
      return 0;
    });

    return NextResponse.json({ stories: groups });
  } catch (err) {
    console.error("[GET /api/v1/stories] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load stories" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const json = await req.json();
    const parsed = createStorySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Photo is required for a Story", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const created = await dbQueryOne<{
      id: string;
      media_url: string;
      caption: string;
      audience: string;
      created_at: string;
    }>(
      `INSERT INTO stories (user_id, author_type, author_persona_id, media_url, caption, audience, viewed_by_user)
       VALUES ($1, 'user', NULL, $2, $3, $4, TRUE)
       RETURNING id, media_url, caption, audience, created_at`,
      [user.id, parsed.data.media_url, parsed.data.caption, parsed.data.audience]
    );

    return NextResponse.json({ story: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to publish story" },
      { status: 500 }
    );
  }
}
