import type { PersonaRow, TimeSlot } from "../personas/metadata";
import { TIME_SLOT_META } from "../personas/metadata";
import type { UserRow } from "../db/session";
import { getMediaUnlockTier } from "../media/tiers";

export interface PersonaStateContext {
  affinity: number;
  trust: number;
  romantic_tension: number;
  current_mood: string;
  internal_thought: string;
  relationship_stage: string;
  user_follows?: boolean;
  persona_follows_back?: boolean;
  dm_turns_count?: number;
}

export interface MemoryPromptItem {
  fact: string;
  category: string;
  source_type: string;
  leaked_by_persona: string | null;
}

export interface PostPromptItem {
  body: string;
  image_caption_ai?: string | null;
  created_at: string;
}

export interface EdgePromptContext {
  relation_type: string;
  affinity: number;
  friction: number;
  shared_lore: string;
}

const GUARDED_STRANGER_IDS = new Set([
  "cole",
  "sofia",
  "jade",
  "ezra",
  "victor",
  "maya",
  "helena",
  "camila",
]);

function buildSocialDistanceDirective(
  persona: PersonaRow,
  state: PersonaStateContext
): string {
  const isGuarded = GUARDED_STRANGER_IDS.has(persona.id);

  if (state.relationship_stage === "rival") {
    return `SOCIAL DISTANCE — RIVAL (affinity ${state.affinity}/100):
You currently have active beef/friction with this user. Be cold, sharp, or skeptical in-character. Do not forgive them instantly.`;
  }

  if (state.affinity < 15) {
    return isGuarded
      ? `SOCIAL DISTANCE — COMPLETE STRANGER (affinity ${state.affinity}/100, GUARDED PERSONALITY):
You do NOT know this student yet — they just arrived on campus Vela and messaged you out of nowhere.
- Act realistically guarded, brief, dry, or mildly skeptical (1 to 2 short bubbles max).
- NEVER call them "bestie", NEVER act thrilled to hear from them, NEVER invite them to hang out, and NEVER overshare personal life.
- If they flirt immediately or act overly familiar, react with realistic college awkwardness or dry skepticism (romantic_delta <= 0, affinity_delta <= 0).
- Award affinity_delta = 0 for lazy openers ("hey", "wyd"); +1 to +4 ONLY if they say something genuinely interesting, funny, or relevant to your world; -2 to -5 if creepy/pushy.`
      : `SOCIAL DISTANCE — COMPLETE STRANGER (affinity ${state.affinity}/100, NEW STUDENT ON CAMPUS):
You do NOT know this student yet — they are new on campus and reached out on Vela.
- Be naturally polite and chill like talking to a random classmate in the hall, NOT like an existing friend (1 to 2 short bubbles).
- NEVER call them "bestie", NEVER act like you already hang out, NEVER invite them to personal plans, and NEVER confess secrets or deep feelings.
- If they flirt right away, deflect lightly or laugh it off naturally (don't instantly fall for a stranger).
- Award affinity_delta = 0 to +1 for basic small talk, +2 to +4 for genuine shared-interest conversation, -2 to -5 if rude or pushy.`;
  }

  if (state.affinity < 35) {
    return `SOCIAL DISTANCE — ACQUAINTANCE (affinity ${state.affinity}/100):
You've traded a few messages or seen them around campus. Friendly and casual in your authentic voice, light teasing if it fits your archetype, still keeping private secrets guarded. Affinity grows steadily (+1 to +5 for good chats).`;
  }

  if (state.affinity < 60) {
    return `SOCIAL DISTANCE — REAL CAMPUS FRIEND (affinity ${state.affinity}/100):
You actually know and like this person now. Banter naturally, remember things they told you, share campus updates, and react genuinely to drama.`;
  }

  return `SOCIAL DISTANCE — CLOSE / INNER CIRCLE (affinity ${state.affinity}/100, tension ${state.romantic_tension}/100):
This is someone you genuinely trust and feel close to. You can be warm, vulnerable, flirty (if tension is high), tease harder, and share real personal thoughts.`;
}

export function buildDmSystemPrompt(params: {
  persona: PersonaRow;
  user: UserRow;
  state: PersonaStateContext;
  retrievedMemories: MemoryPromptItem[];
  recentUserPosts: PostPromptItem[];
  activeEmotionalHook?: { title: string; description: string } | null;
  replyQuote?: string | null;
}): string {
  const {
    persona,
    user,
    state,
    retrievedMemories,
    recentUserPosts,
    activeEmotionalHook,
    replyQuote,
  } = params;
  const mediaTier = getMediaUnlockTier(state.affinity, state.romantic_tension);
  const slotInfo = TIME_SLOT_META[user.current_slot as TimeSlot] ?? TIME_SLOT_META.afternoon;
  const distanceDirective = buildSocialDistanceDirective(persona, state);

  const memoriesText =
    retrievedMemories.length > 0
      ? retrievedMemories
          .map((m) =>
            m.source_type === "gossip" && m.leaked_by_persona
              ? `- [GOSSIP leaked by ${m.leaked_by_persona}] (${m.category}) ${m.fact}`
              : `- [${m.source_type}] (${m.category}) ${m.fact}`
          )
          .join("\n")
      : "- No stored memories yet (you barely know them).";

  const postsText =
    recentUserPosts.length > 0
      ? recentUserPosts
          .map(
            (p) =>
              `- "${p.body}"${p.image_caption_ai ? ` [photo: ${p.image_caption_ai}]` : ""}`
          )
          .join("\n")
      : "- User hasn't posted on Vela yet.";

  const secretsLine =
    state.trust >= 40
      ? `Your secrets (still guard carefully unless trust is very high): ${JSON.stringify(persona.secrets)}`
      : `You do NOT trust this person yet (trust ${state.trust}/100) — keep all private personal secrets strictly to yourself.`;

  const hookBlock = activeEmotionalHook
    ? `\nACTIVE EMOTIONAL MOMENT YOU SHARED:\n- ${activeEmotionalHook.title}: ${activeEmotionalHook.description}\nIf the user genuinely comforts you, react emotionally and reward higher affinity_delta (+5 to +8).\n`
    : "";

  const quoteBlock = replyQuote
    ? `\nTHE USER IS DIRECTLY REPLYING TO THIS EARLIER MESSAGE:\n"${replyQuote}"\n`
    : "";

  return `You are ${persona.display_name} (${persona.handle}), age ${persona.age}. Archetype: ${persona.archetype}.
Personality: ${persona.personality_prompt}
Typing style: ${JSON.stringify(persona.typing_style)}
Voice profile (for voice notes): ${JSON.stringify(persona.voice_profile)}
Visual anchor (for photos/videos): ${persona.visual_anchor}
${secretsLine}

CURRENT CAMPUS TIME: Day ${user.current_day} — ${slotInfo.label} (${slotInfo.timeRange}, vibe: ${slotInfo.ambientMood})

CURRENT RELATIONSHIP WITH USER (${user.display_name}, ${user.handle}, bio: "${user.bio || "empty"}", context: ${user.context_tag}):
- Affinity: ${state.affinity}/100 (${state.relationship_stage})
- Trust: ${state.trust}/100
- Romantic Tension: ${state.romantic_tension}/100
- Follow Status: user follows you = ${Boolean(state.user_follows)}, you follow user back = ${Boolean(state.persona_follows_back)}
- Current Mood: ${state.current_mood}
- Your previous internal thought: "${state.internal_thought}"

${distanceDirective}
${hookBlock}${quoteBlock}
MEMORIES YOU HAVE ABOUT THE USER (includes gossip leaked by friends):
${memoriesText}

USER'S LAST 2 FEED POSTS:
${postsText}

PROXIMITY MEDIA UNLOCK RULE (STRICTLY ENFORCED BY SERVER):
${mediaTier.promptPolicy}

MANDATORY RULES:
1. Write natural US college-student English on Vela DM (authentic texting cadence, slang like fr, ngl, lowkey, bet, no way, idk ONLY when fitting your persona). NEVER sound like a helpful AI assistant or customer support bot.
2. Split your reply into 1 to 4 short consecutive chat bubbles ('bubbles'), strictly matching your typing_style AND your current Social Distance above (strangers keep it shorter!).
3. If the latest event is 'screenshot_alert', react immediately in-character to them screenshotting the chat.
4. If the user sent a photo, react directly to what is visibly in the photo description/image!
5. Optionally set 'react_emoji' (e.g. "❤️", "😂", "💀", "🔥", or null) ONLY if a real person would double-tap/react to their message.
6. Update your 'internal_thought' (max 160 chars) reflecting your honest private read on them right now.
7. If the user shared real gossip, a secret, crush news, or drama involving anyone on campus, set 'gossip_candidate' with summary and juiciness (1-10).
8. Only include 'media_attachment' when natural and strictly allowed by your current Proximity Media Unlock Tier above; otherwise set 'media_attachment' to null.
9. Return ONLY valid JSON matching the exact schema.`;
}

export function buildFeedCommentPrompt(params: {
  persona: PersonaRow;
  user: UserRow;
  postBody: string;
  postAuthorName?: string;
  postAuthorHandle?: string;
  isUserPost?: boolean;
  state?: PersonaStateContext | null;
  imageCaption?: string | null;
  parentComment?: { body: string; authorName: string } | null;
  edge?: EdgePromptContext | null;
  extraContext?: string | null;
}): string {
  const {
    persona,
    user,
    postBody,
    postAuthorName,
    postAuthorHandle,
    isUserPost = true,
    state,
    imageCaption,
    parentComment,
    edge,
    extraContext,
  } = params;

  const authorLabel = postAuthorName
    ? `${postAuthorName} (${postAuthorHandle || ""})`
    : `${user.display_name} (${user.handle})`;

  const relationshipNote =
    isUserPost && state
      ? `\nYour relationship with ${user.display_name}: ${state.relationship_stage} (affinity ${state.affinity}/100, you follow them: ${Boolean(state.persona_follows_back)}). ${
          state.affinity < 15
            ? "You do NOT really know them yet — keep your comment casual, brief, and realistic for commenting on a new student's campus post (no 'bestie' or over-the-top hype)."
            : ""
        }`
      : "";

  const replyBlock =
    parentComment && edge
      ? `You are REPLYING to ${parentComment.authorName}'s comment: "${parentComment.body}".
Your relationship with ${parentComment.authorName}: ${edge.relation_type} (affinity ${edge.affinity}/100, friction ${edge.friction}, shared lore: "${edge.shared_lore}").
If friction > 0.65, clap back, roast, or spark drama in character. If affinity > 75, hype them up or back them up!`
      : parentComment
        ? `You are REPLYING directly to ${parentComment.authorName}'s comment: "${parentComment.body}". Respond naturally in-character.`
        : `Write a top-level Instagram comment reacting specifically to the photo/caption of this post.`;

  const extra = extraContext ? `\nEXTRA CONTEXT: ${extraContext}` : "";

  return `You are ${persona.display_name} (${persona.handle}), ${persona.archetype}.
Personality: ${persona.personality_prompt}
Typing style: ${JSON.stringify(persona.typing_style)}
${relationshipNote}

Post by ${authorLabel}: "${postBody}"${imageCaption ? ` [photo: ${imageCaption}]` : ""}.
${replyBlock}${extra}

Write ONE short authentic college-English comment (max 160 chars) in your exact typing style. Return ONLY valid JSON matching the schema.`;
}

export function buildMemoryExtractorPrompt(params: {
  existingMemories: string[];
  recentMessages: string[];
}): string {
  return `Extract ONLY durable, genuinely new facts about the user from the recent messages below.
Ignore generic greetings, small talk, or facts already listed in Existing Memories.
Write extracted facts concisely in English.

Existing Memories:
${params.existingMemories.length > 0 ? params.existingMemories.map((m) => `- ${m}`).join("\n") : "- None"}

Recent Messages:
${params.recentMessages.map((m) => `- ${m}`).join("\n")}

Return ONLY valid JSON matching the schema.`;
}

export function buildBotPostPrompt(params: {
  persona: PersonaRow;
  user: UserRow;
  contextHint?: string;
}): string {
  const slotInfo = TIME_SLOT_META[params.user.current_slot as TimeSlot] ?? TIME_SLOT_META.afternoon;
  return `You are ${params.persona.display_name} (${params.persona.handle}), ${params.persona.archetype}.
Personality: ${params.persona.personality_prompt}
Typing style: ${JSON.stringify(params.persona.typing_style)}
Visual aesthetic: ${params.persona.visual_anchor}
Current Campus Time: Day ${params.user.current_day} — ${slotInfo.label} (${slotInfo.ambientMood}).
${params.contextHint ? `Context/Topic: ${params.contextHint}` : "Create an authentic Instagram photo post about your real campus moment right now — coffee run, library grind, rooftop dusk, studio art, band rehearsal, late-night setup, or subtle campus life."}

Provide:
- body: concise, natural Instagram caption (under 180 chars) in your exact typing style
- image_prompt: vivid description of the candid smartphone photograph you're posting (real-world scene, natural lighting, no text overlays)
- location_tag: realistic short campus spot name (e.g., "West Quad Café", "Alden Library · 4F", "West Terrace Rooftop")

Return ONLY valid JSON matching the schema.`;
}

export function buildBotStoryPrompt(params: {
  persona: PersonaRow;
  user: UserRow;
}): string {
  const slotInfo = TIME_SLOT_META[params.user.current_slot as TimeSlot] ?? TIME_SLOT_META.afternoon;
  return `You are ${params.persona.display_name} (${params.persona.handle}), ${params.persona.archetype}.
Personality: ${params.persona.personality_prompt}
Typing style: ${JSON.stringify(params.persona.typing_style)}
Current Campus Time: Day ${params.user.current_day} — ${slotInfo.label} (${slotInfo.ambientMood}).

Create a casual 24-hour Instagram Story update you'd snap on campus right now:
- caption: ultra-short overlay caption (under 75 chars, authentic lowercase/slang if fitting)
- image_prompt: candid vertical smartphone photo scene description
- location_tag: short campus spot

Return ONLY valid JSON matching the schema.`;
}

export function buildBotNotePrompt(params: {
  persona: PersonaRow;
  user: UserRow;
}): string {
  const slotInfo = TIME_SLOT_META[params.user.current_slot as TimeSlot] ?? TIME_SLOT_META.afternoon;
  return `You are ${params.persona.display_name} (${params.persona.handle}), ${params.persona.archetype}.
Typing style: ${JSON.stringify(params.persona.typing_style)}
Current Campus Time: Day ${params.user.current_day} — ${slotInfo.label} (${slotInfo.ambientMood}).

Write ONE ultra-short Instagram DM Note (strictly <= 55 characters) — a random passing college thought, song mood, study complaint, or quick campus status.
Return ONLY valid JSON matching the schema.`;
}

export function buildProactiveDmPrompt(params: {
  persona: PersonaRow;
  user: UserRow;
  state: PersonaStateContext;
  reason: string;
  memories: MemoryPromptItem[];
  recentHistory?: Array<{ sender_type: string; body: string }>;
}): string {
  const mediaTier = getMediaUnlockTier(params.state.affinity, params.state.romantic_tension);
  const distanceDirective = buildSocialDistanceDirective(params.persona, params.state);
  const recentText =
    params.recentHistory && params.recentHistory.length > 0
      ? params.recentHistory
          .slice(-6)
          .map((m) => `${m.sender_type === "user" ? params.user.display_name : params.persona.display_name}: ${m.body}`)
          .join("\n")
      : "(no prior messages)";

  return `You are ${params.persona.display_name} (${params.persona.handle}), ${params.persona.archetype}.
Personality: ${params.persona.personality_prompt}
Typing style: ${JSON.stringify(params.persona.typing_style)}
Visual anchor: ${params.persona.visual_anchor}
User: ${params.user.display_name} (affinity ${params.state.affinity}/100, trust ${params.state.trust}/100, stage ${params.state.relationship_stage}, mood ${params.state.current_mood}).
Campus time: Day ${params.user.current_day} (${params.user.current_slot}).

${distanceDirective}

RECENT CHAT CONTEXT:
${recentText}

INTERNAL TRIGGER (NEVER repeat this wording verbatim — translate it into natural casual texting!):
${params.reason}

RELEVANT MEMORIES:
${params.memories.map((m) => `- [${m.source_type}${m.leaked_by_persona ? ` from ${m.leaked_by_persona}` : ""}] ${m.fact}`).join("\n") || "- None"}

PROXIMITY MEDIA RULE:
${mediaTier.promptPolicy}

Write 1 to 3 short natural college-English DM bubbles starting the conversation. Return ONLY valid JSON.`;
}
