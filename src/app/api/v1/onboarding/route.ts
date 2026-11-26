import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { ensureDbReady } from "@/lib/db/migrate";
import { SESSION_COOKIE_NAME, type UserRow } from "@/lib/db/session";
import {
  getInitialThought,
  PERSONA_SEEDS,
  type PersonaRow,
} from "@/lib/personas/metadata";
import { startBackgroundWorkers } from "@/lib/workers/scheduler";
import {
  createAutonomousBotPost,
  refreshCampusStoriesAndNotes,
} from "@/lib/workers/lazy-feed";

const onboardingSchema = z.object({
  display_name: z.string().trim().min(2).max(80),
  handle: z.string().trim().min(2).max(32),
  bio: z.string().trim().max(240).optional().default(""),
  context_tag: z.string().trim().min(2).max(40).optional().default("undergrad"),
});

export async function POST(req: Request) {
  try {
    await ensureDbReady();
    startBackgroundWorkers();

    const body = await req.json();
    const parsed = onboardingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid onboarding fields", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const cleanHandle = parsed.data.handle.startsWith("@")
      ? parsed.data.handle.toLowerCase().replace(/[^a-z0-9._@]/g, "")
      : `@${parsed.data.handle.toLowerCase().replace(/[^a-z0-9._]/g, "")}`;

    const existingHandle = await dbQueryOne<{ id: string }>(
      "SELECT id FROM users WHERE handle = $1",
      [cleanHandle]
    );
    const finalHandle = existingHandle
      ? `${cleanHandle.slice(0, 26)}${Math.floor(100 + Math.random() * 899)}`
      : cleanHandle;

    const user = await dbQueryOne<UserRow>(
      `INSERT INTO users (
        handle, display_name, bio, context_tag, energy, max_energy, current_day, current_slot
      ) VALUES ($1, $2, $3, $4, 20, 20, 1, 'afternoon')
      RETURNING *`,
      [finalHandle, parsed.data.display_name, parsed.data.bio, parsed.data.context_tag]
    );

    if (!user) {
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    // TRUE ZERO-INTIMACY COLD START:
    // Every single one of the 22 campus students starts at 0 affinity, 0 trust, 0 tension,
    // relationship_stage = 'stranger', 0 followers, 0 following!
    for (const p of PERSONA_SEEDS) {
      const thought = getInitialThought(p.id, 0);
      await dbQuery(
        `INSERT INTO user_persona_state (
          user_id, persona_id, affinity, trust, romantic_tension,
          current_mood, internal_thought, relationship_stage, unread_count,
          user_follows, persona_follows_back, is_close_friend, persona_added_close_friend,
          is_rival, dm_turns_count
        ) VALUES ($1, $2, 0, 0, 0, 'chill', $3, 'stranger', 0, FALSE, FALSE, FALSE, FALSE, FALSE, 0)
        ON CONFLICT (user_id, persona_id) DO NOTHING`,
        [user.id, p.id, thought]
      );
    }

    // Seed 5 authentic photorealistic campus posts from existing students (campus life happens
    // independently of the new student arriving!) + natural bot-to-bot campus comments.
    const starterPosters = await dbQuery<PersonaRow>(
      "SELECT * FROM personas WHERE id IN ('chloe', 'theo', 'bella', 'lucas', 'maya') ORDER BY id"
    );
    const createdPosts = await Promise.all(
      starterPosters.rows.map((bot) =>
        createAutonomousBotPost({
          user,
          persona: bot,
          withCascade: false,
        })
      )
    );
    const seededPosts: Array<{ id: string; author_persona_id: string }> = createdPosts
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({ id: c.id, author_persona_id: c.author_persona_id }));

    // Add a couple of authentic bot-to-bot campus comments under existing posts so the campus feels alive
    const starterComments: Array<{ authorId: string; commenterId: string; body: string }> = [
      { authorId: "chloe", commenterId: "leo", body: "bring notes to foundry later, I'll quiz you over coffee" },
      { authorId: "chloe", commenterId: "nina", body: "fourth floor library has quiet tables open rn btw" },
      { authorId: "theo", commenterId: "brody", body: "west terrace view never misses fr" },
      { authorId: "bella", commenterId: "jade", body: "the lighting here is actually so clean ✨" },
      { authorId: "lucas", commenterId: "parker", body: "bro go to sleep before 8am lab tomorrow lol" },
    ];
    for (const sc of starterComments) {
      const targetPost = seededPosts.find((p) => p.author_persona_id === sc.authorId);
      if (targetPost) {
        await dbQuery(
          `INSERT INTO comments (post_id, user_id, parent_comment_id, author_type, author_persona_id, body, likes_count)
           VALUES ($1, $2, NULL, 'persona', $3, $4, $5)`,
          [targetPost.id, user.id, sc.commenterId, sc.body, Math.floor(Math.random() * 5) + 1]
        );
      }
    }

    // Seed real 24h campus Stories (photorealistic photos) & DM Notes (60-char thoughts)
    await refreshCampusStoriesAndNotes(user, 6);

    // ZERO forced Bella/Chloe welcome DMs and ZERO Day-1 Bella Golden-Hour invites!
    // You arrive on campus as a genuine new student (0 followers, 0 following, 0 intimacy).

    const response = NextResponse.json({
      user,
      initialized_personas: PERSONA_SEEDS.length,
      welcome_dms_scheduled: 0,
      cold_start: true,
    });

    response.cookies.set(SESSION_COOKIE_NAME, user.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  } catch (err) {
    console.error("[POST /api/v1/onboarding] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Onboarding failed" },
      { status: 500 }
    );
  }
}
