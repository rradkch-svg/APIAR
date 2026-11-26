import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import { refreshCampusStoriesAndNotes } from "@/lib/workers/lazy-feed";

const createNoteSchema = z.object({
  body: z.string().trim().min(1).max(60),
});

export async function GET() {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    await refreshCampusStoriesAndNotes(user, 6);

    const res = await dbQuery<{
      id: string;
      author_type: "user" | "persona";
      author_persona_id: string | null;
      body: string;
      created_at: string;
      persona_name: string | null;
      persona_handle: string | null;
      persona_avatar: string | null;
      affinity: number | null;
    }>(
      `SELECT
         n.id, n.author_type, n.author_persona_id, n.body, n.created_at,
         p.display_name AS persona_name,
         p.handle AS persona_handle,
         p.avatar_url AS persona_avatar,
         ups.affinity
       FROM dm_notes n
       LEFT JOIN personas p ON p.id = n.author_persona_id
       LEFT JOIN user_persona_state ups ON ups.persona_id = n.author_persona_id AND ups.user_id = $1
       WHERE n.user_id = $1 AND n.expires_at > NOW()
       ORDER BY
         CASE WHEN n.author_type = 'user' THEN 0 ELSE 1 END,
         COALESCE(ups.affinity, 0) DESC,
         n.created_at DESC`,
      [user.id]
    );

    const notes = res.rows.map((r) => ({
      id: r.id,
      author_type: r.author_type,
      author_persona_id: r.author_persona_id,
      author_name: r.author_type === "user" ? user.display_name : r.persona_name || "Campus",
      author_handle:
        r.author_type === "user"
          ? user.handle.replace(/^@/, "")
          : (r.persona_handle || "campus").replace(/^@/, ""),
      author_avatar: r.author_type === "user" ? user.avatar_url : r.persona_avatar,
      body: r.body,
      created_at: r.created_at,
    }));

    return NextResponse.json({ notes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load notes" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const json = await req.json();
    const parsed = createNoteSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Note must be 1 to 60 characters" },
        { status: 400 }
      );
    }

    await dbQuery("DELETE FROM dm_notes WHERE user_id = $1 AND author_type = 'user'", [user.id]);
    const note = await dbQueryOne<{ id: string; body: string; created_at: string }>(
      `INSERT INTO dm_notes (user_id, author_type, author_persona_id, body)
       VALUES ($1, 'user', NULL, $2)
       RETURNING id, body, created_at`,
      [user.id, parsed.data.body]
    );

    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to post note" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    await dbQuery("DELETE FROM dm_notes WHERE user_id = $1 AND author_type = 'user'", [user.id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete note" },
      { status: 500 }
    );
  }
}
