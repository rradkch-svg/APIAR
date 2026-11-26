import { z } from "zod";

export const MOOD_VALUES = [
  "hyped",
  "annoyed",
  "flirty",
  "suspicious",
  "chill",
  "jealous",
  "amused",
] as const;

export const MEMORY_CATEGORIES = [
  "pet",
  "location",
  "taste",
  "secret",
  "drama",
  "promise",
  "study_work",
  "general",
] as const;

export const mediaAttachmentSchema = z.object({
  type: z.enum(["image", "audio", "video"]),
  prompt_or_script: z.string().min(1).max(400),
  duration_sec: z.number().int().min(3).max(25).optional(),
  view_once: z.boolean().optional(),
});

export const dmEngineSchema = z.object({
  bubbles: z.array(z.string().min(1)).min(1).max(4),
  affinity_delta: z.number().int().min(-10).max(10),
  romantic_delta: z.number().int().min(-5).max(8),
  new_mood: z.enum(MOOD_VALUES),
  internal_thought: z.string().min(1).max(160),
  react_emoji: z.string().max(12).nullable().optional(),
  gossip_candidate: z
    .object({
      summary: z.string().min(1),
      juiciness: z.number().int().min(1).max(10),
    })
    .nullable()
    .optional(),
  media_attachment: mediaAttachmentSchema.nullable().optional(),
});

export type DmEngineOutput = z.infer<typeof dmEngineSchema>;

export const feedCommentSchema = z.object({
  comment: z.string().min(1).max(180),
  likes_post: z.boolean(),
  affinity_delta: z.number().int().min(-5).max(5),
});

export type FeedCommentOutput = z.infer<typeof feedCommentSchema>;

export const memoryExtractorSchema = z.object({
  new_facts: z.array(
    z.object({
      fact: z.string().min(1),
      category: z.enum(MEMORY_CATEGORIES),
      importance: z.number().int().min(1).max(10),
    })
  ),
});

export type MemoryExtractorOutput = z.infer<typeof memoryExtractorSchema>;

export const botPostSchema = z.object({
  body: z.string().min(1).max(280),
  image_prompt: z.string().max(260).optional(),
  location_tag: z.string().max(80).optional(),
  mood: z.enum(MOOD_VALUES).optional(),
});

export type BotPostOutput = z.infer<typeof botPostSchema>;

export const botStorySchema = z.object({
  caption: z.string().max(140),
  image_prompt: z.string().min(4).max(260),
  location_tag: z.string().max(80).optional(),
});

export type BotStoryOutput = z.infer<typeof botStorySchema>;

export const botNoteSchema = z.object({
  body: z.string().min(1).max(60),
});

export type BotNoteOutput = z.infer<typeof botNoteSchema>;

export const proactiveDmSchema = z.object({
  bubbles: z.array(z.string().min(1)).min(1).max(3),
  new_mood: z.enum(MOOD_VALUES),
  internal_thought: z.string().min(1).max(160),
  media_attachment: mediaAttachmentSchema.nullable().optional(),
});

export type ProactiveDmOutput = z.infer<typeof proactiveDmSchema>;

export const DM_ENGINE_JSON_SCHEMA = {
  type: "object",
  required: ["bubbles", "affinity_delta", "romantic_delta", "new_mood", "internal_thought"],
  properties: {
    bubbles: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string" },
    },
    affinity_delta: { type: "integer", minimum: -10, maximum: 10 },
    romantic_delta: { type: "integer", minimum: -5, maximum: 8 },
    new_mood: { type: "string", enum: [...MOOD_VALUES] },
    internal_thought: { type: "string", maxLength: 160 },
    react_emoji: { type: ["string", "null"], maxLength: 12 },
    gossip_candidate: {
      type: ["object", "null"],
      properties: {
        summary: { type: "string" },
        juiciness: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["summary", "juiciness"],
    },
    media_attachment: {
      type: ["object", "null"],
      properties: {
        type: { type: "string", enum: ["image", "audio", "video"] },
        prompt_or_script: { type: "string", maxLength: 400 },
        duration_sec: { type: "integer", minimum: 3, maximum: 25 },
        view_once: { type: "boolean" },
      },
      required: ["type", "prompt_or_script"],
    },
  },
} as const;

export const FEED_COMMENT_JSON_SCHEMA = {
  type: "object",
  required: ["comment", "likes_post", "affinity_delta"],
  properties: {
    comment: { type: "string", maxLength: 180 },
    likes_post: { type: "boolean" },
    affinity_delta: { type: "integer", minimum: -5, maximum: 5 },
  },
} as const;

export const MEMORY_EXTRACTOR_JSON_SCHEMA = {
  type: "object",
  required: ["new_facts"],
  properties: {
    new_facts: {
      type: "array",
      items: {
        type: "object",
        required: ["fact", "category", "importance"],
        properties: {
          fact: { type: "string" },
          category: { type: "string", enum: [...MEMORY_CATEGORIES] },
          importance: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
    },
  },
} as const;

export const BOT_POST_JSON_SCHEMA = {
  type: "object",
  required: ["body", "image_prompt"],
  properties: {
    body: { type: "string", maxLength: 280 },
    image_prompt: { type: "string", maxLength: 260 },
    location_tag: { type: "string", maxLength: 80 },
    mood: { type: "string", enum: [...MOOD_VALUES] },
  },
} as const;

export const BOT_STORY_JSON_SCHEMA = {
  type: "object",
  required: ["caption", "image_prompt"],
  properties: {
    caption: { type: "string", maxLength: 140 },
    image_prompt: { type: "string", maxLength: 260 },
    location_tag: { type: "string", maxLength: 80 },
  },
} as const;

export const BOT_NOTE_JSON_SCHEMA = {
  type: "object",
  required: ["body"],
  properties: {
    body: { type: "string", maxLength: 60 },
  },
} as const;

export const PROACTIVE_DM_JSON_SCHEMA = {
  type: "object",
  required: ["bubbles", "new_mood", "internal_thought"],
  properties: {
    bubbles: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string" },
    },
    new_mood: { type: "string", enum: [...MOOD_VALUES] },
    internal_thought: { type: "string", maxLength: 160 },
    media_attachment: {
      type: ["object", "null"],
      properties: {
        type: { type: "string", enum: ["image", "audio", "video"] },
        prompt_or_script: { type: "string", maxLength: 400 },
        duration_sec: { type: "integer", minimum: 3, maximum: 25 },
        view_once: { type: "boolean" },
      },
      required: ["type", "prompt_or_script"],
    },
  },
} as const;
