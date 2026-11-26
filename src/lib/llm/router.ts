import type { z } from "zod";
import { getEffectiveLlmMode, getRuntimeConfig } from "../config/runtime";
import type { PersonaRow } from "../personas/metadata";
import type { UserRow } from "../db/session";
import { enforceMediaAttachmentPolicy } from "../media/tiers";
import {
  BOT_NOTE_JSON_SCHEMA,
  botNoteSchema,
  BOT_POST_JSON_SCHEMA,
  botPostSchema,
  BOT_STORY_JSON_SCHEMA,
  botStorySchema,
  DM_ENGINE_JSON_SCHEMA,
  dmEngineSchema,
  FEED_COMMENT_JSON_SCHEMA,
  feedCommentSchema,
  MEMORY_CATEGORIES,
  MEMORY_EXTRACTOR_JSON_SCHEMA,
  memoryExtractorSchema,
  MOOD_VALUES,
  PROACTIVE_DM_JSON_SCHEMA,
  proactiveDmSchema,
  type BotNoteOutput,
  type BotPostOutput,
  type BotStoryOutput,
  type DmEngineOutput,
  type FeedCommentOutput,
  type MemoryExtractorOutput,
  type ProactiveDmOutput,
} from "./schemas";
import {
  buildBotNotePrompt,
  buildBotPostPrompt,
  buildBotStoryPrompt,
  buildDmSystemPrompt,
  buildFeedCommentPrompt,
  buildMemoryExtractorPrompt,
  buildProactiveDmPrompt,
  type EdgePromptContext,
  type MemoryPromptItem,
  type PersonaStateContext,
  type PostPromptItem,
} from "./prompts";
import {
  mockBotNote,
  mockBotPost,
  mockBotStory,
  mockDmResponse,
  mockExtractMemories,
  mockFeedComment,
  mockImageCaption,
  mockProactiveDm,
} from "./mock";

export type LlmTier = "fast_tier" | "roleplay_tier";

interface StructuredCallParams<T> {
  tier: LlmTier;
  taskName: string;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  zodSchema: z.ZodType<T>;
}

const VALID_MOODS = new Set<string>(MOOD_VALUES);
const VALID_MEM_CATS = new Set<string>(MEMORY_CATEGORIES);

function clampInt(val: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeMood(val: unknown): (typeof MOOD_VALUES)[number] {
  const lower = String(val || "").toLowerCase().trim();
  if (VALID_MOODS.has(lower)) return lower as (typeof MOOD_VALUES)[number];
  if (/hype|excit|happy|pumped|stoked|enthus|energetic/.test(lower)) return "hyped";
  if (/annoy|mad|angry|irritat|frustrat|cold|dry|unbothered|bored/.test(lower)) return "annoyed";
  if (/flirt|warm|crush|romantic|shy|blush|intrigued/.test(lower)) return "flirty";
  if (/suspic|skeptic|guard|cautious|wary|weird|confused|skept/.test(lower)) return "suspicious";
  if (/jealous|envious|possessive|petty/.test(lower)) return "jealous";
  if (/amus|playful|funny|teas|laugh|sarcas|smirk/.test(lower)) return "amused";
  return "chill";
}

function normalizeMediaAttachment(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const type = String(obj.type || "").toLowerCase().trim();
  if (type !== "image" && type !== "audio" && type !== "video") return null;
  const promptOrScript = String(obj.prompt_or_script || "").trim().slice(0, 400);
  if (!promptOrScript) return null;
  const result: Record<string, unknown> = {
    type,
    prompt_or_script: promptOrScript,
  };
  if (obj.duration_sec !== undefined && obj.duration_sec !== null) {
    result.duration_sec = clampInt(obj.duration_sec, 3, 25, 9);
  }
  if (typeof obj.view_once === "boolean") {
    result.view_once = obj.view_once;
  }
  return result;
}

/**
 * Gently clamps/sanitizes minor LLM output formatting quirks (e.g., 165-char internal thoughts,
 * float deltas, synonym moods) so live AI responses don't needlessly fail Zod validation.
 */
function sanitizeStructuredPayload(taskName: string, raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = { ...(raw as Record<string, unknown>) };

  if (taskName === "dm_response" || taskName === "screenshot_reaction") {
    const rawBubbles = Array.isArray(obj.bubbles)
      ? obj.bubbles
      : typeof obj.bubbles === "string"
        ? [obj.bubbles]
        : [];
    const cleanedBubbles = rawBubbles
      .map((b) => String(b ?? "").trim())
      .filter((b) => b.length > 0)
      .slice(0, 4);
    if (cleanedBubbles.length > 0) obj.bubbles = cleanedBubbles;

    obj.affinity_delta = clampInt(obj.affinity_delta, -10, 10, 0);
    obj.romantic_delta = clampInt(obj.romantic_delta, -5, 8, 0);
    obj.new_mood = normalizeMood(obj.new_mood);
    obj.internal_thought = String(obj.internal_thought || "Just keeping things casual.")
      .trim()
      .slice(0, 160);

    if (
      obj.react_emoji === "" ||
      obj.react_emoji === "null" ||
      obj.react_emoji === "none" ||
      obj.react_emoji === undefined
    ) {
      obj.react_emoji = null;
    } else if (typeof obj.react_emoji === "string") {
      obj.react_emoji = obj.react_emoji.trim().slice(0, 12) || null;
    }

    if (obj.gossip_candidate && typeof obj.gossip_candidate === "object") {
      const gc = obj.gossip_candidate as Record<string, unknown>;
      const summary = String(gc.summary || "").trim();
      if (!summary) {
        obj.gossip_candidate = null;
      } else {
        obj.gossip_candidate = {
          summary: summary.slice(0, 240),
          juiciness: clampInt(gc.juiciness, 1, 10, 5),
        };
      }
    } else {
      obj.gossip_candidate = null;
    }

    obj.media_attachment = normalizeMediaAttachment(obj.media_attachment);
    return obj;
  }

  if (taskName === "proactive_dm") {
    const rawBubbles = Array.isArray(obj.bubbles) ? obj.bubbles : [];
    const cleanedBubbles = rawBubbles
      .map((b) => String(b ?? "").trim())
      .filter((b) => b.length > 0)
      .slice(0, 3);
    if (cleanedBubbles.length > 0) obj.bubbles = cleanedBubbles;
    obj.new_mood = normalizeMood(obj.new_mood);
    obj.internal_thought = String(obj.internal_thought || "Felt like texting.")
      .trim()
      .slice(0, 160);
    obj.media_attachment = normalizeMediaAttachment(obj.media_attachment);
    return obj;
  }

  if (taskName === "feed_comment" || taskName === "comment_reply") {
    if (typeof obj.comment === "string") obj.comment = obj.comment.trim().slice(0, 180);
    obj.likes_post = Boolean(obj.likes_post);
    obj.affinity_delta = clampInt(obj.affinity_delta, -5, 5, 1);
    return obj;
  }

  if (taskName === "memory_extract") {
    const facts = Array.isArray(obj.new_facts) ? obj.new_facts : [];
    obj.new_facts = facts
      .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === "object"))
      .map((f) => {
        const cat = String(f.category || "general").toLowerCase().trim();
        return {
          fact: String(f.fact || "").trim().slice(0, 240),
          category: VALID_MEM_CATS.has(cat) ? cat : "general",
          importance: clampInt(f.importance, 1, 10, 5),
        };
      })
      .filter((f) => f.fact.length > 0);
    return obj;
  }

  if (taskName === "bot_post") {
    if (typeof obj.body === "string") obj.body = obj.body.trim().slice(0, 280);
    if (typeof obj.image_prompt === "string") obj.image_prompt = obj.image_prompt.trim().slice(0, 260);
    if (typeof obj.location_tag === "string") obj.location_tag = obj.location_tag.trim().slice(0, 80);
    if (obj.mood !== undefined && obj.mood !== null) obj.mood = normalizeMood(obj.mood);
    else delete obj.mood;
    return obj;
  }

  if (taskName === "bot_story") {
    obj.caption = String(obj.caption ?? "").trim().slice(0, 140);
    const ip = String(obj.image_prompt ?? obj.caption ?? "Candid campus moment").trim();
    obj.image_prompt = (ip.length >= 4 ? ip : "Candid campus moment").slice(0, 260);
    if (typeof obj.location_tag === "string") obj.location_tag = obj.location_tag.trim().slice(0, 80);
    else delete obj.location_tag;
    return obj;
  }

  if (taskName === "bot_note") {
    if (typeof obj.body === "string") obj.body = obj.body.trim().slice(0, 60);
    return obj;
  }

  return obj;
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

async function callGeminiModel<T>(
  apiKey: string,
  model: string,
  params: StructuredCallParams<T>
): Promise<T> {
  const { GoogleGenAI, ThinkingLevel } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const isGemini3 = /^gemini-3/i.test(model);
  const response = await ai.models.generateContent({
    model,
    contents: params.userPrompt,
    config: {
      systemInstruction: params.systemPrompt,
      responseMimeType: "application/json",
      responseJsonSchema: params.jsonSchema,
      temperature: params.tier === "roleplay_tier" ? 0.9 : 0.7,
      abortSignal: AbortSignal.timeout(12000),
      ...(isGemini3
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
        : {}),
    },
  });

  const text = response.text;
  if (!text) throw new Error(`Gemini (${model}) returned empty text for ${params.taskName}`);
  const parsed = JSON.parse(extractJsonText(text));
  const sanitized = sanitizeStructuredPayload(params.taskName, parsed);
  return params.zodSchema.parse(sanitized);
}

async function callGeminiStructured<T>(params: StructuredCallParams<T>): Promise<T> {
  const cfg = getRuntimeConfig();
  const primaryModel =
    params.tier === "roleplay_tier" ? cfg.geminiRoleplayModel : cfg.geminiFastModel;
  const secondaryModel =
    params.tier === "roleplay_tier"
      ? cfg.geminiRoleplayFallbackModel
      : cfg.geminiFastFallbackModel;

  try {
    return await callGeminiModel(cfg.geminiApiKey, primaryModel, params);
  } catch (primaryErr) {
    if (secondaryModel && secondaryModel !== primaryModel) {
      console.warn(
        `[llm/router] Gemini ${primaryModel} failed on ${params.taskName}, retrying ${secondaryModel}:`,
        primaryErr instanceof Error ? primaryErr.message.slice(0, 120) : primaryErr
      );
      return await callGeminiModel(cfg.geminiApiKey, secondaryModel, params);
    }
    throw primaryErr;
  }
}

async function callOpenAIEndpointStructured<T>(
  baseUrl: string,
  apiKey: string,
  model: string,
  params: StructuredCallParams<T>
): Promise<T> {
  const endpoint = `${baseUrl}/chat/completions`;

  const makeRequest = async (useStrictJsonSchema: boolean) => {
    const body: Record<string, unknown> = {
      model,
      temperature: params.tier === "roleplay_tier" ? 0.88 : 0.7,
      max_tokens: params.tier === "roleplay_tier" ? 420 : 260,
      messages: [
        { role: "system", content: params.systemPrompt },
        {
          role: "user",
          content: useStrictJsonSchema
            ? params.userPrompt
            : `${params.userPrompt}\n\nRespond ONLY with raw valid JSON matching this schema (no markdown fences):\n${JSON.stringify(params.jsonSchema)}`,
        },
      ],
      response_format: useStrictJsonSchema
        ? {
            type: "json_schema",
            json_schema: {
              name: params.taskName,
              strict: false,
              schema: params.jsonSchema,
            },
          }
        : { type: "json_object" },
    };

    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(22000),
    });
  };

  // Many open-weights NIM/OpenAI-compatible hosts prefer json_object directly over json_schema
  const preferSimpleJson = baseUrl.includes("nvidia.com");
  let res = await makeRequest(!preferSimpleJson);
  if (!res.ok && !preferSimpleJson && (res.status === 400 || res.status === 422)) {
    res = await makeRequest(false);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI-compatible API (${model}) ${res.status}: ${errText.slice(0, 180)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error(`OpenAI-compatible provider (${model}) returned empty content`);
  const parsed = JSON.parse(extractJsonText(content));
  const sanitized = sanitizeStructuredPayload(params.taskName, parsed);
  return params.zodSchema.parse(sanitized);
}

async function runStructuredOrFallback<T>(
  params: StructuredCallParams<T>,
  fallbackFn: () => T
): Promise<{ data: T; providerUsed: "gemini" | "openai_compatible" | "mock" }> {
  const cfg = getRuntimeConfig();
  const effective = getEffectiveLlmMode();
  if (effective.mode === "mock") {
    return { data: fallbackFn(), providerUsed: "mock" };
  }

  // Primary path: Dual Free-Tier Load Splitting when both Gemini & NVIDIA NIM are active!
  // - fast_tier (feed posts, comments, stories, notes, memory): NVIDIA NIM first -> Gemini failover
  //   (protects Gemini Free Tier RPM exclusively for DMs, Vision, Embeddings, and 22-Voice TTS!)
  // - roleplay_tier (DMs, screenshot reactions, proactive DMs): Gemini first -> NVIDIA NIM failover!
  if (effective.mode === "gemini") {
    const hasSecondaryNim = Boolean(cfg.fallbackApiKey && cfg.fallbackBaseUrl && cfg.fallbackModel);

    if (params.tier === "fast_tier" && hasSecondaryNim) {
      try {
        const data = await callOpenAIEndpointStructured(
          cfg.fallbackBaseUrl,
          cfg.fallbackApiKey,
          cfg.fallbackModel,
          params
        );
        return { data, providerUsed: "openai_compatible" };
      } catch (nimErr) {
        console.warn(
          `[llm/router] Fast-tier NIM (${cfg.fallbackModel}) failed on ${params.taskName}, failing over to Gemini:`,
          nimErr instanceof Error ? nimErr.message.slice(0, 140) : nimErr
        );
        try {
          const data = await callGeminiStructured(params);
          return { data, providerUsed: "gemini" };
        } catch (gemErr) {
          console.warn(
            `[llm/router] Fast-tier Gemini failover also failed on ${params.taskName}:`,
            gemErr instanceof Error ? gemErr.message.slice(0, 140) : gemErr
          );
          return { data: fallbackFn(), providerUsed: "mock" };
        }
      }
    }

    try {
      const data = await callGeminiStructured(params);
      return { data, providerUsed: "gemini" };
    } catch (err) {
      console.warn(
        `[llm/router] Gemini failed on ${params.taskName}:`,
        err instanceof Error ? err.message.slice(0, 150) : err
      );

      // Automatic Secondary LIVE Free Failover (NVIDIA NIM) before ever touching Mock!
      if (hasSecondaryNim) {
        try {
          const data = await callOpenAIEndpointStructured(
            cfg.fallbackBaseUrl,
            cfg.fallbackApiKey,
            cfg.fallbackModel,
            params
          );
          console.info(
            `[llm/router] Failover succeeded via ${cfg.fallbackModel} on ${params.taskName}`
          );
          return { data, providerUsed: "openai_compatible" };
        } catch (fbErr) {
          console.warn(
            `[llm/router] Secondary live failover (${cfg.fallbackModel}) also failed on ${params.taskName}:`,
            fbErr instanceof Error ? fbErr.message.slice(0, 150) : fbErr
          );
        }
      }

      return { data: fallbackFn(), providerUsed: "mock" };
    }
  }

  // Primary path: OpenAI-compatible (e.g., NVIDIA NIM / OpenRouter / xAI) -> Gemini failover!
  const primaryUrl = cfg.llmBaseUrl || cfg.fallbackBaseUrl;
  const primaryKey = cfg.llmApiKey || cfg.fallbackApiKey;
  const primaryModel =
    cfg.llmApiKey && cfg.llmBaseUrl
      ? params.tier === "roleplay_tier"
        ? cfg.llmRoleplayModel
        : cfg.llmFastModel
      : cfg.fallbackModel;

  try {
    const data = await callOpenAIEndpointStructured(primaryUrl, primaryKey, primaryModel, params);
    return { data, providerUsed: "openai_compatible" };
  } catch (err) {
    console.warn(
      `[llm/router] openai_compatible failed on ${params.taskName}:`,
      err instanceof Error ? err.message.slice(0, 150) : err
    );
    if (cfg.geminiApiKey) {
      try {
        const data = await callGeminiStructured(params);
        return { data, providerUsed: "gemini" };
      } catch (gErr) {
        console.warn(
          `[llm/router] Secondary Gemini failover failed on ${params.taskName}:`,
          gErr instanceof Error ? gErr.message.slice(0, 150) : gErr
        );
      }
    }
    return { data: fallbackFn(), providerUsed: "mock" };
  }
}

export async function generateDmTurn(params: {
  persona: PersonaRow;
  user: UserRow;
  state: PersonaStateContext;
  history: Array<{ sender_type: string; message_type: string; body: string }>;
  userMessage: string;
  messageType: "text" | "image" | "screenshot_alert" | "story_reply" | "note_reply" | "post_share";
  imageCaption?: string | null;
  replyQuote?: string | null;
  retrievedMemories: MemoryPromptItem[];
  recentUserPosts: PostPromptItem[];
  activeEmotionalHook?: { title: string; description: string } | null;
}): Promise<{
  output: DmEngineOutput;
  providerUsed: "gemini" | "openai_compatible" | "mock";
  mediaBlockedReason: string | null;
}> {
  const systemPrompt = buildDmSystemPrompt({
    persona: params.persona,
    user: params.user,
    state: params.state,
    retrievedMemories: params.retrievedMemories,
    recentUserPosts: params.recentUserPosts,
    activeEmotionalHook: params.activeEmotionalHook,
    replyQuote: params.replyQuote,
  });

  const historyLines = params.history
    .slice(-15)
    .map(
      (m) =>
        `${m.sender_type === "user" ? params.user.display_name : params.persona.display_name} (${m.message_type}): ${m.body}`
    )
    .join("\n");

  const latestEvent =
    params.messageType === "screenshot_alert"
      ? `[SYSTEM EVENT: screenshot_alert — ${params.user.display_name} just took a screenshot of this DM conversation!]`
      : params.messageType === "image"
        ? `${params.user.display_name} sent a photo: "${params.userMessage || "(no caption)"}" [Photo contents: ${params.imageCaption || "candid campus photo"}]`
        : params.messageType === "story_reply"
          ? `${params.user.display_name} replied to your Story: "${params.userMessage}"`
          : params.messageType === "note_reply"
            ? `${params.user.display_name} replied to your DM Note: "${params.userMessage}"`
            : params.messageType === "post_share"
              ? `${params.user.display_name} shared a Vela feed post in DM: "${params.userMessage}"`
              : `${params.user.display_name}: ${params.userMessage}`;

  const userPrompt = `RECENT DM HISTORY (max 15 messages):\n${historyLines || "(new conversation)"}\n\nLATEST EVENT:\n${latestEvent}`;

  const { data, providerUsed } = await runStructuredOrFallback(
    {
      tier: "roleplay_tier",
      taskName: params.messageType === "screenshot_alert" ? "screenshot_reaction" : "dm_response",
      systemPrompt,
      userPrompt,
      jsonSchema: DM_ENGINE_JSON_SCHEMA as unknown as Record<string, unknown>,
      zodSchema: dmEngineSchema,
    },
    () =>
      mockDmResponse({
        persona: params.persona,
        user: params.user,
        state: params.state,
        userMessage: params.userMessage,
        messageType: params.messageType,
        imageCaption: params.imageCaption,
        historyLength: params.history.length,
        retrievedMemories: params.retrievedMemories,
        activeEmotionalHook: params.activeEmotionalHook,
      })
  );

  // HARD BACKEND PROXIMITY GATE
  const gate = enforceMediaAttachmentPolicy(
    data.media_attachment,
    params.state.affinity,
    params.state.romantic_tension
  );

  if (gate.blockedReason) {
    console.info(`[llm/router] Proximity Gate: ${gate.blockedReason}`);
  }

  return {
    output: {
      ...data,
      media_attachment: gate.attachment,
    },
    providerUsed,
    mediaBlockedReason: gate.blockedReason,
  };
}

export async function generateFeedComment(params: {
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
}): Promise<{ output: FeedCommentOutput; providerUsed: string }> {
  const systemPrompt = buildFeedCommentPrompt(params);
  const { data, providerUsed } = await runStructuredOrFallback(
    {
      tier: "fast_tier",
      taskName: params.parentComment ? "comment_reply" : "feed_comment",
      systemPrompt,
      userPrompt: "Generate the comment JSON now.",
      jsonSchema: FEED_COMMENT_JSON_SCHEMA as unknown as Record<string, unknown>,
      zodSchema: feedCommentSchema,
    },
    () => mockFeedComment(params)
  );
  return { output: data, providerUsed };
}

export async function extractMemoriesFromMessages(params: {
  recentMessages: string[];
  existingMemories: string[];
}): Promise<MemoryExtractorOutput> {
  const systemPrompt = buildMemoryExtractorPrompt(params);
  const { data } = await runStructuredOrFallback(
    {
      tier: "fast_tier",
      taskName: "memory_extract",
      systemPrompt,
      userPrompt: "Extract new durable user facts as JSON.",
      jsonSchema: MEMORY_EXTRACTOR_JSON_SCHEMA as unknown as Record<string, unknown>,
      zodSchema: memoryExtractorSchema,
    },
    () => mockExtractMemories(params)
  );
  return data;
}

export async function generateBotPost(params: {
  persona: PersonaRow;
  user: UserRow;
  contextHint?: string;
}): Promise<BotPostOutput> {
  const systemPrompt = buildBotPostPrompt(params);
  const { data } = await runStructuredOrFallback(
    {
      tier: "fast_tier",
      taskName: "bot_post",
      systemPrompt,
      userPrompt: "Generate the campus photo post JSON now.",
      jsonSchema: BOT_POST_JSON_SCHEMA as unknown as Record<string, unknown>,
      zodSchema: botPostSchema,
    },
    () => mockBotPost(params)
  );
  return data;
}

export async function generateBotStory(params: {
  persona: PersonaRow;
  user: UserRow;
}): Promise<BotStoryOutput> {
  const systemPrompt = buildBotStoryPrompt(params);
  const { data } = await runStructuredOrFallback(
    {
      tier: "fast_tier",
      taskName: "bot_story",
      systemPrompt,
      userPrompt: "Generate the Instagram Story JSON now.",
      jsonSchema: BOT_STORY_JSON_SCHEMA as unknown as Record<string, unknown>,
      zodSchema: botStorySchema,
    },
    () => mockBotStory(params)
  );
  return data;
}

export async function generateBotNote(params: {
  persona: PersonaRow;
  user: UserRow;
}): Promise<BotNoteOutput> {
  const systemPrompt = buildBotNotePrompt(params);
  const { data } = await runStructuredOrFallback(
    {
      tier: "fast_tier",
      taskName: "bot_note",
      systemPrompt,
      userPrompt: "Generate the short DM Note JSON now.",
      jsonSchema: BOT_NOTE_JSON_SCHEMA as unknown as Record<string, unknown>,
      zodSchema: botNoteSchema,
    },
    () => mockBotNote(params)
  );
  return data;
}

export async function generateProactiveDm(params: {
  persona: PersonaRow;
  user: UserRow;
  state: PersonaStateContext;
  reason: string;
  memories: MemoryPromptItem[];
  recentHistory?: Array<{ sender_type: string; body: string }>;
  allowMedia?: boolean;
}): Promise<ProactiveDmOutput> {
  const systemPrompt = buildProactiveDmPrompt(params);
  const { data } = await runStructuredOrFallback(
    {
      tier: "roleplay_tier",
      taskName: "proactive_dm",
      systemPrompt,
      userPrompt: "Write your proactive DM bubbles as JSON.",
      jsonSchema: PROACTIVE_DM_JSON_SCHEMA as unknown as Record<string, unknown>,
      zodSchema: proactiveDmSchema,
    },
    () => mockProactiveDm(params)
  );

  const gate = enforceMediaAttachmentPolicy(
    params.allowMedia === false ? null : data.media_attachment,
    params.state.affinity,
    params.state.romantic_tension
  );

  return {
    ...data,
    media_attachment: gate.attachment,
  };
}

export async function captionUserPostImage(
  imageUrl: string,
  postBody: string
): Promise<string> {
  const cfg = getRuntimeConfig();

  if (cfg.geminiApiKey && imageUrl.startsWith("data:image/")) {
    const match = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
      for (const model of [cfg.geminiFastModel, cfg.geminiRoleplayModel]) {
        try {
          const res = await ai.models.generateContent({
            model,
            contents: [
              { inlineData: { mimeType: match[1], data: match[2] } },
              {
                text: `Describe this social media photo in one vivid concise English sentence for campus friends reacting to it. Caption: "${postBody}"`,
              },
            ],
          });
          if (res.text?.trim()) return res.text.trim().slice(0, 240);
        } catch (err) {
          console.warn(`[llm/router] Gemini Vision (${model}) caption failed:`, err);
        }
      }
    }
  } else if (
    cfg.llmProvider === "openai_compatible" &&
    cfg.llmApiKey &&
    cfg.llmBaseUrl &&
    (imageUrl.startsWith("data:image/") || imageUrl.startsWith("http"))
  ) {
    try {
      const res = await fetch(`${cfg.llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.llmApiKey}`,
        },
        body: JSON.stringify({
          model: cfg.llmRoleplayModel,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Describe this candid college photo in one vivid concise English sentence. Caption: "${postBody}"`,
                },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = json.choices?.[0]?.message?.content?.trim();
        if (text) return text.slice(0, 240);
      }
    } catch (err) {
      console.warn("[llm/router] OpenAI-compatible Vision caption failed:", err);
    }
  }

  return mockImageCaption(imageUrl, postBody);
}
