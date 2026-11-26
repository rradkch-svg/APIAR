import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import type { PersonaRow } from "@/lib/personas/metadata";
import { generateDmTurn } from "@/lib/llm/router";
import { retrieveTopMemories } from "@/lib/llm/embeddings";
import {
  applyUserPersonaStateUpdate,
  deliverPersonaTurnBubbles,
  type PersistedDmRow,
} from "@/lib/workers/deliver";

const interactSchema = z.object({
  action: z.enum(["view", "like", "reply"]),
  reply_text: z.string().trim().max(300).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const { id: storyId } = await context.params;
    const json = await req.json();
    const parsed = interactSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid story action" }, { status: 400 });
    }

    const story = await dbQueryOne<{
      id: string;
      author_type: "user" | "persona";
      author_persona_id: string | null;
      media_url: string;
      caption: string;
      liked_by_user: boolean;
    }>("SELECT * FROM stories WHERE id = $1 AND user_id = $2", [storyId, user.id]);

    if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });

    if (parsed.data.action === "view") {
      await dbQuery("UPDATE stories SET viewed_by_user = TRUE WHERE id = $1", [story.id]);
      return NextResponse.json({ ok: true, viewed: true });
    }

    if (parsed.data.action === "like") {
      const nextLiked = !story.liked_by_user;
      await dbQuery("UPDATE stories SET liked_by_user = $2, viewed_by_user = TRUE WHERE id = $1", [
        story.id,
        nextLiked,
      ]);
      if (nextLiked && story.author_persona_id) {
        await applyUserPersonaStateUpdate(user.id, story.author_persona_id, {
          affinityDelta: 1,
        });
      }
      return NextResponse.json({ ok: true, liked: nextLiked });
    }

    // action === "reply" -> sends a story_reply DM into that persona's thread & triggers realistic reply!
    const replyText = parsed.data.reply_text?.trim();
    if (!replyText || !story.author_persona_id) {
      return NextResponse.json({ error: "Reply text is required" }, { status: 400 });
    }

    const [persona, stateRow] = await Promise.all([
      dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [story.author_persona_id]),
      dbQueryOne<{
        affinity: number;
        trust: number;
        romantic_tension: number;
        current_mood: string;
        internal_thought: string;
        relationship_stage: string;
      }>(
        `SELECT affinity, trust, romantic_tension, current_mood, internal_thought, relationship_stage
         FROM user_persona_state WHERE user_id = $1 AND persona_id = $2`,
        [user.id, story.author_persona_id]
      ),
    ]);

    if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

    const msg = await dbQueryOne<PersistedDmRow>(
      `INSERT INTO dm_messages (
        user_id, persona_id, sender_type, message_type, body, media_url, media_metadata
      ) VALUES ($1, $2, 'user', 'story_reply', $3, $4, $5::jsonb)
      RETURNING *`,
      [
        user.id,
        persona.id,
        replyText,
        story.media_url,
        JSON.stringify({
          story_id: story.id,
          story_caption: story.caption,
        }),
      ]
    );

    const state = stateRow || {
      affinity: 0,
      trust: 0,
      romantic_tension: 0,
      current_mood: "chill",
      internal_thought: "",
      relationship_stage: "stranger",
    };

    const memories = await retrieveTopMemories(user.id, persona.id, replyText, 4);
    const { output } = await generateDmTurn({
      persona,
      user,
      state,
      history: [],
      userMessage: `[Replied to your Story "${story.caption}"]: ${replyText}`,
      messageType: "story_reply",
      retrievedMemories: memories,
      recentUserPosts: [],
    });

    const updatedState = await applyUserPersonaStateUpdate(user.id, persona.id, {
      affinityDelta: output.affinity_delta,
      newMood: output.new_mood,
      internalThought: output.internal_thought,
      incrementDmTurns: true,
    });

    void deliverPersonaTurnBubbles({
      userId: user.id,
      persona,
      bubbles: output.bubbles,
      mediaAttachment: output.media_attachment,
      reactEmoji: output.react_emoji ?? null,
      reactTargetMessageId: msg?.id ?? null,
      stateUpdate: updatedState,
      instant: false,
      pushNotification: true,
      incrementUnread: true,
    }).catch((err) => console.error("[story reply delivery]", err));

    return NextResponse.json({ ok: true, persona_id: persona.id, message: msg });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Story interaction failed" },
      { status: 500 }
    );
  }
}
