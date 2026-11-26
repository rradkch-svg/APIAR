import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQueryOne } from "@/lib/db/client";
import { getActiveUser } from "@/lib/db/session";
import type { PersonaRow } from "@/lib/personas/metadata";
import { generateDmTurn } from "@/lib/llm/router";
import { retrieveTopMemories } from "@/lib/llm/embeddings";
import {
  applyUserPersonaStateUpdate,
  deliverPersonaTurnBubbles,
  type PersistedDmRow,
} from "@/lib/workers/deliver";

const shareSchema = z.object({
  persona_id: z.string().min(1),
  note: z.string().trim().max(240).optional().default(""),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getActiveUser();
    if (!user) return NextResponse.json({ error: "Onboarding required" }, { status: 401 });

    const { id: postId } = await context.params;
    const json = await req.json();
    const parsed = shareSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid share target" }, { status: 400 });
    }

    const [post, persona, stateRow] = await Promise.all([
      dbQueryOne<{
        id: string;
        body: string;
        image_url: string | null;
        author_type: string;
        author_handle: string | null;
        author_name: string | null;
      }>(
        `SELECT p.id, p.body, p.image_url, p.author_type,
                per.handle AS author_handle, per.display_name AS author_name
         FROM posts p
         LEFT JOIN personas per ON per.id = p.author_persona_id
         WHERE p.id = $1 AND p.user_id = $2`,
        [postId, user.id]
      ),
      dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [parsed.data.persona_id]),
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
        [user.id, parsed.data.persona_id]
      ),
    ]);

    if (!post || !persona) {
      return NextResponse.json({ error: "Post or recipient not found" }, { status: 404 });
    }

    const authorHandle = post.author_type === "user" ? user.handle : post.author_handle || "@campus";
    const shareText = parsed.data.note
      ? `${parsed.data.note} — shared ${authorHandle}'s post: "${post.body.slice(0, 90)}"`
      : `Shared ${authorHandle}'s post: "${post.body.slice(0, 90)}"`;

    const msg = await dbQueryOne<PersistedDmRow>(
      `INSERT INTO dm_messages (
        user_id, persona_id, sender_type, message_type, body, media_url, media_metadata
      ) VALUES ($1, $2, 'user', 'post_share', $3, $4, $5::jsonb)
      RETURNING *`,
      [
        user.id,
        persona.id,
        parsed.data.note || post.body.slice(0, 120),
        post.image_url,
        JSON.stringify({
          shared_post_id: post.id,
          shared_author_handle: authorHandle,
          shared_author_name: post.author_type === "user" ? user.display_name : post.author_name,
          shared_body: post.body,
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

    const memories = await retrieveTopMemories(user.id, persona.id, shareText, 4);
    const { output } = await generateDmTurn({
      persona,
      user,
      state,
      history: [],
      userMessage: shareText,
      messageType: "post_share",
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
    }).catch((err) => console.error("[share DM delivery]", err));

    return NextResponse.json({ ok: true, shared_to: persona.id, message: msg });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to share post" },
      { status: 500 }
    );
  }
}
