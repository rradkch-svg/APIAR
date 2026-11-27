import seedEdgesJson from "../../../db/seed_graph_edges_en.json";
import {
  advanceTimeSlot,
  computeRelationshipStage,
  getInitialThought,
  isPersonaOnline,
  PERSONA_SEEDS,
  TIME_SLOT_META,
  type PersonaRow,
  type TimeSlot,
} from "@/lib/personas/metadata";
import type { UserRow } from "@/lib/db/session";
import { enforceMediaAttachmentPolicy, getMediaUnlockTier } from "@/lib/media/tiers";
import {
  mockBotNote,
  mockBotPost,
  mockBotStory,
  mockDmResponse,
  mockExtractMemories,
  mockFeedComment,
  mockImageCaption,
  mockProactiveDm,
} from "@/lib/llm/mock";
import { pickStaticCampusPhoto, withBasePath } from "./photos";

interface EdgeSeed {
  source_id: string;
  target_id: string;
  relation_type: string;
  affinity: number;
  friction: number;
  gossip_trust: number;
  shared_lore: string;
}

const EDGE_SEEDS: EdgeSeed[] = seedEdgesJson as EdgeSeed[];

interface PersonaState {
  persona_id: string;
  affinity: number;
  trust: number;
  romantic_tension: number;
  current_mood: string;
  internal_thought: string;
  relationship_stage: string;
  unread_count: number;
  user_follows: boolean;
  persona_follows_back: boolean;
  is_close_friend: boolean;
  persona_added_close_friend: boolean;
  is_rival: boolean;
  dm_turns_count: number;
  dm_last_seen_at: string | null;
  last_interaction_at: string | null;
  updated_at: string;
}

interface StoredComment {
  id: string;
  post_id: string;
  parent_comment_id: string | null;
  author_type: "user" | "persona";
  author_persona_id: string | null;
  body: string;
  likes_count: number;
  created_at: string;
}

interface StoredPost {
  id: string;
  author_type: "user" | "persona";
  author_persona_id: string | null;
  body: string;
  image_url: string | null;
  media_urls: string[];
  location_tag: string | null;
  audience: string;
  liked_by_user: boolean;
  liked_by_personas: string[];
  saved_by_user: boolean;
  saved_at: string | null;
  image_caption_ai: string | null;
  likes_count: number;
  views_count: number;
  created_at: string;
}

interface StoredStory {
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
}

interface StoredNote {
  id: string;
  author_type: "user" | "persona";
  author_persona_id: string | null;
  body: string;
  expires_at: string;
  created_at: string;
}

interface StoredDmMessage {
  id: string;
  persona_id: string;
  sender_type: "user" | "persona" | "system";
  message_type:
    | "text"
    | "image"
    | "audio"
    | "video"
    | "screenshot_alert"
    | "post_share"
    | "event_invite"
    | "story_reply"
    | "note_reply";
  body: string;
  media_url: string | null;
  media_metadata: Record<string, unknown>;
  reaction: string | null;
  reply_to_message_id: string | null;
  read_at: string | null;
  bubble_group_id: string | null;
  created_at: string;
}

interface StoredMemory {
  id: string;
  persona_id: string;
  fact: string;
  category: string;
  importance: number;
  source_type: string;
  leaked_by_persona: string | null;
  created_at: string;
}

interface StoredGossip {
  id: string;
  origin_persona_id: string;
  summary: string;
  juiciness: number;
  reached_personas: string[];
  created_at: string;
}

interface StoredWorldEvent {
  id: string;
  user_id: string;
  persona_id: string;
  event_type: "spontaneous_ping" | "emotional_hook" | "invite";
  title: string;
  description: string;
  scheduled_day: number;
  scheduled_slot: TimeSlot;
  status: "pending" | "accepted" | "declined" | "flaked" | "completed" | "expired";
  reward_affinity: number;
  penalty_affinity: number;
  conflict_group: string | null;
  dm_message_id: string | null;
  created_at: string;
}

interface StaticSettings {
  llm_provider: "gemini" | "openai_compatible";
  gemini_api_key: string;
  gemini_roleplay_model: string;
  gemini_fast_model: string;
  gemini_embedding_model: string;
  llm_base_url: string;
  llm_api_key: string;
  llm_roleplay_model: string;
  llm_fast_model: string;
  image_provider: "auto" | "gemini" | "openai_compatible" | "pollinations" | "curated";
  image_base_url: string;
  image_api_key: string;
  image_model: string;
  tts_provider: "auto" | "elevenlabs" | "gemini" | "openai" | "edge_neural";
  elevenlabs_api_key: string;
  elevenlabs_model: string;
  gemini_tts_model: string;
  tts_base_url: string;
  tts_api_key: string;
  tts_model: string;
  media_video_endpoint: string;
  speed_multiplier: number;
}

interface StaticStore {
  user: UserRow | null;
  states: Record<string, PersonaState>;
  posts: StoredPost[];
  comments: StoredComment[];
  stories: StoredStory[];
  notes: StoredNote[];
  messages: StoredDmMessage[];
  memories: StoredMemory[];
  gossip: StoredGossip[];
  worldEvents: StoredWorldEvent[];
  settings: StaticSettings;
}

const STORAGE_KEY = "vela_campus_static_v1";

const PERSONA_ROWS: PersonaRow[] = PERSONA_SEEDS.map((p) => ({
  ...p,
  avatar_url: withBasePath(p.avatar_url),
  is_active: true,
}));

const PERSONA_MAP: Record<string, PersonaRow> = Object.fromEntries(
  PERSONA_ROWS.map((p) => [p.id, p])
);

type RealtimeSubscriber = (event: string, data: Record<string, unknown>) => void;
const realtimeSubscribers = new Set<RealtimeSubscriber>();

export function subscribeStaticRealtime(fn: RealtimeSubscriber): () => void {
  realtimeSubscribers.add(fn);
  return () => {
    realtimeSubscribers.delete(fn);
  };
}

function emitEvent(event: string, data: Record<string, unknown>) {
  for (const fn of realtimeSubscribers) {
    try {
      fn(event, data);
    } catch {
      // ignore listener errors
    }
  }
}

function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function defaultSettings(): StaticSettings {
  return {
    llm_provider: "gemini",
    gemini_api_key: "",
    gemini_roleplay_model: "gemini-2.5-flash",
    gemini_fast_model: "gemini-2.5-flash-lite",
    gemini_embedding_model: "gemini-embedding-001",
    llm_base_url: "https://integrate.api.nvidia.com/v1",
    llm_api_key: "",
    llm_roleplay_model: "nvidia/nemotron-3.5-bolt-e4b",
    llm_fast_model: "nvidia/nemotron-3.5-bolt-e4b",
    image_provider: "curated",
    image_base_url: "",
    image_api_key: "",
    image_model: "gemini-3.1-flash-image",
    tts_provider: "edge_neural",
    elevenlabs_api_key: "",
    elevenlabs_model: "eleven_flash_v2_5",
    gemini_tts_model: "gemini-2.5-flash-preview-tts",
    tts_base_url: "https://api.openai.com/v1",
    tts_api_key: "",
    tts_model: "gpt-4o-mini-tts",
    media_video_endpoint: "",
    speed_multiplier: 5,
  };
}

function emptyStore(): StaticStore {
  return {
    user: null,
    states: {},
    posts: [],
    comments: [],
    stories: [],
    notes: [],
    messages: [],
    memories: [],
    gossip: [],
    worldEvents: [],
    settings: defaultSettings(),
  };
}

let memoryStore: StaticStore | null = null;

function loadStore(): StaticStore {
  if (memoryStore) return memoryStore;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StaticStore>;
        memoryStore = {
          ...emptyStore(),
          ...parsed,
          settings: { ...defaultSettings(), ...(parsed.settings || {}) },
        };
        return memoryStore;
      }
    } catch {
      // ignore corrupted storage
    }
  }
  memoryStore = emptyStore();
  return memoryStore;
}

function saveStore(store: StaticStore) {
  memoryStore = store;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Quota exceeded (e.g. large uploaded data URL) — keep in-memory store alive
    }
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function scaledDelay(baseMs: number, minMs = 450): number {
  const store = loadStore();
  const mult = Math.max(1, store.settings.speed_multiplier || 5);
  return Math.max(minMs, Math.round(baseMs / mult));
}

function effectiveRuntime(s: StaticSettings) {
  const hasGemini = Boolean(s.gemini_api_key.trim());
  const hasOpenai = Boolean(s.llm_api_key.trim() && s.llm_base_url.trim());
  const mode: "gemini" | "openai_compatible" | "mock" =
    s.llm_provider === "gemini" && hasGemini
      ? "gemini"
      : s.llm_provider === "openai_compatible" && hasOpenai
        ? "openai_compatible"
        : hasGemini
          ? "gemini"
          : hasOpenai
            ? "openai_compatible"
            : "mock";
  return {
    llm_mode: mode,
    llm_provider: s.llm_provider,
    roleplay_model: mode === "openai_compatible" ? s.llm_roleplay_model : s.gemini_roleplay_model,
    fast_model: mode === "openai_compatible" ? s.llm_fast_model : s.gemini_fast_model,
    embedding_model: s.gemini_embedding_model,
    image_mode: "curated-real-photos",
    tts_mode: "transcript-preview",
    llm_base_url: s.llm_base_url,
    has_api_key: hasGemini || hasOpenai,
    db_driver: "pglite" as const,
    speed_multiplier: s.speed_multiplier,
  };
}

function updatePersonaState(
  store: StaticStore,
  personaId: string,
  opts: {
    affinityDelta?: number;
    trustDelta?: number;
    romanticDelta?: number;
    newMood?: string;
    internalThought?: string;
    incrementDmTurns?: boolean;
  }
): PersonaState {
  const existing = store.states[personaId] || {
    persona_id: personaId,
    affinity: 0,
    trust: 0,
    romantic_tension: 0,
    current_mood: "chill",
    internal_thought: getInitialThought(personaId, 0),
    relationship_stage: "stranger",
    unread_count: 0,
    user_follows: false,
    persona_follows_back: false,
    is_close_friend: false,
    persona_added_close_friend: false,
    is_rival: false,
    dm_turns_count: 0,
    dm_last_seen_at: null,
    last_interaction_at: null,
    updated_at: nowIso(),
  };

  const nextAffinity = clamp(existing.affinity + (opts.affinityDelta || 0), 0, 100);
  const nextTrust = clamp(existing.trust + (opts.trustDelta || 0), 0, 100);
  const nextRomantic = clamp(existing.romantic_tension + (opts.romanticDelta || 0), 0, 100);
  const nextStage = computeRelationshipStage(nextAffinity, nextRomantic);
  const updated: PersonaState = {
    ...existing,
    affinity: nextAffinity,
    trust: nextTrust,
    romantic_tension: nextRomantic,
    current_mood: opts.newMood || existing.current_mood,
    internal_thought: opts.internalThought || existing.internal_thought,
    relationship_stage: nextStage,
    persona_follows_back: existing.persona_follows_back || nextAffinity >= 18,
    persona_added_close_friend: existing.persona_added_close_friend || nextAffinity >= 55,
    dm_turns_count: existing.dm_turns_count + (opts.incrementDmTurns ? 1 : 0),
    last_interaction_at: nowIso(),
    updated_at: nowIso(),
  };
  store.states[personaId] = updated;
  return updated;
}

function createBotPost(store: StaticStore, persona: PersonaRow, createdOffsetMs = 0): StoredPost {
  const user = store.user!;
  const recentUrls = store.posts.slice(0, 12).map((p) => p.image_url || "").filter(Boolean);
  const generated = mockBotPost({ persona, user });
  const picked = pickStaticCampusPhoto({
    persona,
    prompt: generated.image_prompt || generated.body,
    sceneKind: "post",
    excludeUrls: recentUrls,
  });

  // Pick 2-3 authentic campus likers from persona's friends
  const friendIds = EDGE_SEEDS.filter((e) => e.source_id === persona.id && e.affinity > 0)
    .map((e) => e.target_id)
    .slice(0, 3);
  const likers =
    friendIds.length > 0
      ? friendIds
      : PERSONA_ROWS.filter((p) => p.id !== persona.id)
          .slice(0, 2)
          .map((p) => p.id);

  const likesCount = 14 + ((persona.id.charCodeAt(0) * 7 + store.posts.length * 11) % 45);
  const post: StoredPost = {
    id: uid(),
    author_type: "persona",
    author_persona_id: persona.id,
    body: generated.body,
    image_url: picked.imageUrl,
    media_urls: [picked.imageUrl],
    location_tag: picked.location,
    audience: "campus",
    liked_by_user: false,
    liked_by_personas: likers,
    saved_by_user: false,
    saved_at: null,
    image_caption_ai: generated.image_prompt || null,
    likes_count: likesCount,
    views_count: likesCount * 4 + 30,
    created_at: nowIso(createdOffsetMs),
  };
  store.posts.unshift(post);
  return post;
}

function ensureCampusStoriesAndNotes(store: StaticStore, targetCount = 6) {
  if (!store.user) return;
  const now = Date.now();
  store.stories = store.stories.filter((s) => new Date(s.expires_at).getTime() > now);
  store.notes = store.notes.filter((n) => new Date(n.expires_at).getTime() > now);

  const botStories = store.stories.filter((s) => s.author_type === "persona");
  if (botStories.length < targetCount) {
    const existingAuthors = new Set(botStories.map((s) => s.author_persona_id));
    const candidates = PERSONA_ROWS.filter((p) => !existingAuthors.has(p.id));
    const needed = targetCount - botStories.length;
    const usedUrls = store.stories.map((s) => s.media_url);
    for (let i = 0; i < Math.min(needed, candidates.length); i++) {
      const p = candidates[(i * 3 + store.user.current_day) % candidates.length];
      if (!p || existingAuthors.has(p.id)) continue;
      existingAuthors.add(p.id);
      const draft = mockBotStory({ persona: p, user: store.user });
      const photo = pickStaticCampusPhoto({
        persona: p,
        prompt: draft.image_prompt || draft.caption,
        sceneKind: "story",
        excludeUrls: usedUrls,
      });
      usedUrls.push(photo.imageUrl);
      store.stories.push({
        id: uid(),
        author_type: "persona",
        author_persona_id: p.id,
        media_url: photo.imageUrl,
        caption: draft.caption,
        audience: "campus",
        viewed_by_user: false,
        liked_by_user: false,
        expires_at: nowIso(24 * 60 * 60 * 1000),
        created_at: nowIso(-(i + 1) * 18 * 60 * 1000),
      });
    }
  }

  const botNotes = store.notes.filter((n) => n.author_type === "persona");
  if (botNotes.length < 8) {
    const existingAuthors = new Set(botNotes.map((n) => n.author_persona_id));
    for (let i = 0; i < PERSONA_ROWS.length && store.notes.filter((n) => n.author_type === "persona").length < 8; i++) {
      const p = PERSONA_ROWS[(i * 2 + store.user.current_day) % PERSONA_ROWS.length];
      if (!p || existingAuthors.has(p.id)) continue;
      existingAuthors.add(p.id);
      const draft = mockBotNote({ persona: p, user: store.user });
      store.notes.push({
        id: uid(),
        author_type: "persona",
        author_persona_id: p.id,
        body: draft.body.slice(0, 60),
        expires_at: nowIso(24 * 60 * 60 * 1000),
        created_at: nowIso(-(i + 1) * 12 * 60 * 1000),
      });
    }
  }
}

async function tryLiveBrowserLlmDm(
  nativeFetch: typeof window.fetch,
  settings: StaticSettings,
  persona: PersonaRow,
  user: UserRow,
  state: PersonaState,
  history: Array<{ sender_type: string; body: string }>,
  userMessage: string
): Promise<{ bubbles: string[]; mood?: string } | null> {
  const eff = effectiveRuntime(settings);
  if (eff.llm_mode === "mock") return null;

  const sysPrompt = `You are ${persona.display_name} (${persona.handle}), a college student on Vela campus social app.
Archetype: ${persona.archetype}. Bio: ${persona.bio}.
Style: ${persona.personality_prompt}
Relationship with ${user.display_name} (${user.handle}): stage=${state.relationship_stage}, affinity=${state.affinity}/100, trust=${state.trust}/100.
Keep replies ultra-natural like real Instagram DMs (1-2 short casual bubbles, lowercase if your style is lowercase).
Return ONLY valid JSON: {"bubbles":["..."],"mood":"chill"}`;

  const recentText = history
    .slice(-8)
    .map((m) => `${m.sender_type === "user" ? user.display_name : persona.display_name}: ${m.body}`)
    .join("\n");
  const prompt = `${recentText ? `Recent chat:\n${recentText}\n\n` : ""}${user.display_name}: ${userMessage}`;

  try {
    if (eff.llm_mode === "gemini" && settings.gemini_api_key.trim()) {
      const model = settings.gemini_roleplay_model || "gemini-2.5-flash";
      const res = await nativeFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.gemini_api_key.trim())}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sysPrompt }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
          }),
        }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;
      const parsed = JSON.parse(text) as { bubbles?: string[]; mood?: string };
      if (Array.isArray(parsed.bubbles) && parsed.bubbles.length > 0) {
        return { bubbles: parsed.bubbles.slice(0, 3).map(String), mood: parsed.mood };
      }
    } else if (eff.llm_mode === "openai_compatible" && settings.llm_api_key.trim() && settings.llm_base_url.trim()) {
      const base = settings.llm_base_url.replace(/\/+$/, "");
      const res = await nativeFetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.llm_api_key.trim()}`,
        },
        body: JSON.stringify({
          model: settings.llm_roleplay_model,
          messages: [
            { role: "system", content: sysPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0.9,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content?.trim();
      if (!raw) return null;
      try {
        const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(cleaned) as { bubbles?: string[]; mood?: string };
        if (Array.isArray(parsed.bubbles) && parsed.bubbles.length > 0) {
          return { bubbles: parsed.bubbles.slice(0, 3).map(String), mood: parsed.mood };
        }
      } catch {
        return { bubbles: [raw.slice(0, 280)] };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function triggerGossipCascade(
  store: StaticStore,
  originPersonaId: string,
  summary: string,
  juiciness: number
) {
  const origin = PERSONA_MAP[originPersonaId];
  if (!origin) return;
  const hop1 = EDGE_SEEDS.filter(
    (e) => e.source_id === originPersonaId && e.gossip_trust >= 0.6
  )
    .sort((a, b) => b.gossip_trust - a.gossip_trust)
    .slice(0, 2);

  const reached = new Set<string>();
  for (const e of hop1) {
    reached.add(e.target_id);
    store.memories.unshift({
      id: uid(),
      persona_id: e.target_id,
      fact: `${origin.display_name} told me: ${summary}`,
      category: "gossip",
      importance: Math.min(10, juiciness),
      source_type: "gossip",
      leaked_by_persona: originPersonaId,
      created_at: nowIso(),
    });
  }

  if (reached.size > 0) {
    store.gossip.unshift({
      id: uid(),
      origin_persona_id: originPersonaId,
      summary,
      juiciness,
      reached_personas: Array.from(reached),
      created_at: nowIso(),
    });
    emitEvent("notification:push", {
      title: "Campus buzz",
      body: `${origin.display_name} talked to ${Array.from(reached).join(", ")} about what you said.`,
      route: "/crew",
    });
  }
}

function schedulePersonaReply(params: {
  persona: PersonaRow;
  bubbles: string[];
  mediaAttachment: ReturnType<typeof enforceMediaAttachmentPolicy>["attachment"];
  reactEmoji?: string | null;
  reactTargetId?: string | null;
  pushNotification?: boolean;
  incrementUnread?: boolean;
}) {
  const { persona, bubbles, mediaAttachment, reactEmoji, reactTargetId, pushNotification, incrementUnread } = params;

  const firstDelay = scaledDelay(1600, 400);
  setTimeout(() => {
    const store = loadStore();
    if (!store.user) return;
    // Mark user's last message as Seen
    const now = nowIso();
    let sawMsg = false;
    for (let i = store.messages.length - 1; i >= 0; i--) {
      const m = store.messages[i];
      if (m.persona_id === persona.id && m.sender_type === "user" && !m.read_at) {
        m.read_at = now;
        sawMsg = true;
        break;
      }
    }
    if (sawMsg) {
      emitEvent("dm:read", { persona_id: persona.id, read_at: now });
    }
    if (reactEmoji && reactTargetId) {
      const target = store.messages.find((m) => m.id === reactTargetId);
      if (target) {
        target.reaction = reactEmoji;
        emitEvent("dm:reaction", {
          persona_id: persona.id,
          message_id: reactTargetId,
          reaction: reactEmoji,
        });
      }
    }
    saveStore(store);

    emitEvent("typing:start", {
      persona_id: persona.id,
      activity: mediaAttachment?.type === "audio" ? "recording" : mediaAttachment ? "sending_media" : "typing",
    });
  }, Math.max(250, Math.round(firstDelay * 0.45)));

  const groupId = uid();
  let cumulative = firstDelay;
  bubbles.forEach((text, idx) => {
    cumulative += idx === 0 ? 0 : scaledDelay(1300, 450);
    const delay = cumulative;
    const isLast = idx === bubbles.length - 1 && !mediaAttachment;
    setTimeout(() => {
      const store = loadStore();
      if (!store.user) return;
      const msg: StoredDmMessage = {
        id: uid(),
        persona_id: persona.id,
        sender_type: "persona",
        message_type: "text",
        body: text,
        media_url: null,
        media_metadata: {},
        reaction: null,
        reply_to_message_id: null,
        read_at: null,
        bubble_group_id: groupId,
        created_at: nowIso(),
      };
      store.messages.push(msg);
      if (incrementUnread && store.states[persona.id]) {
        store.states[persona.id].unread_count += 1;
      }
      saveStore(store);
      emitEvent("dm:bubble", { persona_id: persona.id, message: msg });
      if (isLast) {
        emitEvent("typing:stop", { persona_id: persona.id });
        if (pushNotification) {
          emitEvent("notification:push", {
            title: persona.display_name,
            body: text,
            route: `/dms/${persona.id}`,
          });
        }
      }
    }, delay);
  });

  if (mediaAttachment) {
    cumulative += scaledDelay(1500, 500);
    setTimeout(() => {
      const store = loadStore();
      if (!store.user) return;
      let mediaUrl: string | null = null;
      const meta: Record<string, unknown> = {
        prompt: mediaAttachment.prompt_or_script,
        view_once: Boolean(mediaAttachment.view_once),
      };
      if (mediaAttachment.type === "image") {
        const picked = pickStaticCampusPhoto({
          persona,
          prompt: mediaAttachment.prompt_or_script,
          sceneKind: mediaAttachment.view_once ? "view_once" : "ambient",
        });
        mediaUrl = picked.imageUrl;
      } else if (mediaAttachment.type === "audio") {
        meta.transcript = mediaAttachment.prompt_or_script;
        meta.duration_sec = mediaAttachment.duration_sec || 9;
        meta.waveform = [
          0.35, 0.62, 0.85, 0.5, 0.91, 0.66, 0.42, 0.82, 0.58, 0.94, 0.49, 0.75, 0.88, 0.53,
          0.79, 0.61, 0.9, 0.57, 0.44, 0.72, 0.64, 0.48, 0.36, 0.3,
        ];
      } else if (mediaAttachment.type === "video") {
        const picked = pickStaticCampusPhoto({
          persona,
          prompt: mediaAttachment.prompt_or_script,
          sceneKind: "selfie",
        });
        mediaUrl = picked.imageUrl;
        meta.duration_sec = mediaAttachment.duration_sec || 5;
        meta.caption = mediaAttachment.prompt_or_script;
      }

      const msg: StoredDmMessage = {
        id: uid(),
        persona_id: persona.id,
        sender_type: "persona",
        message_type: mediaAttachment.type,
        body:
          mediaAttachment.type === "audio"
            ? mediaAttachment.prompt_or_script
            : mediaAttachment.type === "image"
              ? "Sent a photo"
              : "Sent a video note",
        media_url: mediaUrl,
        media_metadata: meta,
        reaction: null,
        reply_to_message_id: null,
        read_at: null,
        bubble_group_id: groupId,
        created_at: nowIso(),
      };
      store.messages.push(msg);
      if (incrementUnread && store.states[persona.id]) {
        store.states[persona.id].unread_count += 1;
      }
      saveStore(store);
      emitEvent("dm:bubble", { persona_id: persona.id, message: msg });
      emitEvent("typing:stop", { persona_id: persona.id });
    }, cumulative);
  }
}

interface FormattedCommentNode {
  id: string;
  post_id: string;
  parent_comment_id: string | null;
  author_type: "user" | "persona";
  author_persona_id: string | null;
  author_name: string;
  author_handle: string;
  author_avatar: string | null;
  author_accent: string;
  body: string;
  likes_count: number;
  relation_to_parent: string | null;
  created_at: string;
  replies: FormattedCommentNode[];
}

function formatCommentNode(c: StoredComment, user: UserRow): FormattedCommentNode {
  const persona = c.author_persona_id ? PERSONA_MAP[c.author_persona_id] : null;
  return {
    id: c.id,
    post_id: c.post_id,
    parent_comment_id: c.parent_comment_id,
    author_type: c.author_type,
    author_persona_id: c.author_persona_id,
    author_name: c.author_type === "user" ? user.display_name : persona?.display_name || "Campus Student",
    author_handle: c.author_type === "user" ? user.handle : persona?.handle || "@campus",
    author_avatar: c.author_type === "user" ? user.avatar_url : persona?.avatar_url || null,
    author_accent: c.author_type === "user" ? "#5E5CE6" : persona?.accent_color || "#5E5CE6",
    body: c.body,
    likes_count: c.likes_count,
    relation_to_parent: null,
    created_at: c.created_at,
    replies: [],
  };
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readJsonBody(init?: RequestInit): Promise<Record<string, unknown>> {
  if (!init?.body) return {};
  if (typeof init.body === "string") {
    try {
      return JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

const INVITE_POOL: Array<{
  personaId: string;
  minAffinity: number;
  title: string;
  description: string;
  inviteLine: string;
}> = [
  {
    personaId: "nina",
    minAffinity: 12,
    title: "Student Union New-Student Mixer",
    description: "Nina is hosting an open campus org mixer at the Student Union — good way to meet people.",
    inviteLine: "hey! student council is hosting a chill new-student mixer at the union — swing by if you're free",
  },
  {
    personaId: "brody",
    minAffinity: 14,
    title: "Open Quad Hangout & Grill",
    description: "Brody is firing up the grill on Cedar St with half the dorms.",
    inviteLine: "yo we're setting up the grill on cedar st with people from campus — feel free to swing by",
  },
  {
    personaId: "chloe",
    minAffinity: 25,
    title: "Emergency Iced Coffee & People-Watching",
    description: "Chloe needs caffeine and someone normal to roast campus life with on the quad.",
    inviteLine: "sos i need an iced coffee and someone normal to sit on the quad with, u free?",
  },
  {
    personaId: "bella",
    minAffinity: 30,
    title: "Golden-Hour Rooftop Shoot",
    description: "Bella wants help shooting golden hour photos on West Terrace.",
    inviteLine: "wait are you free later? need someone with actual taste for a golden-hour shoot on west terrace ✨",
  },
  {
    personaId: "theo",
    minAffinity: 35,
    title: "West Terrace Sunset Chill",
    description: "Theo saved a spot on the rooftop before sunset.",
    inviteLine: "heading up to west terrace before sunset if you wanna escape campus noise for an hour",
  },
];

export async function handleStaticApiRequest(
  rawUrl: string,
  init: RequestInit | undefined,
  nativeFetch: typeof window.fetch
): Promise<Response> {
  const url = new URL(rawUrl, typeof window !== "undefined" ? window.location.origin : "http://localhost");
  const basePrefix = process.env.NEXT_PUBLIC_BASE_PATH || "";
  let pathname = url.pathname;
  if (basePrefix && pathname.startsWith(basePrefix)) {
    pathname = pathname.slice(basePrefix.length) || "/";
  }
  const method = (init?.method || "GET").toUpperCase();
  const store = loadStore();

  // 1. /api/v1/me
  if (pathname === "/api/v1/me" && method === "GET") {
    const rt = effectiveRuntime(store.settings);
    if (!store.user) {
      return jsonRes({ user: null, needs_onboarding: true, runtime: rt });
    }
    const states = Object.values(store.states);
    return jsonRes({
      user: store.user,
      needs_onboarding: false,
      followers_count: states.filter((s) => s.persona_follows_back).length,
      following_count: states.filter((s) => s.user_follows).length,
      close_friends_count: states.filter((s) => s.is_close_friend).length,
      posts_count: store.posts.filter((p) => p.author_type === "user").length,
      saved_count: store.posts.filter((p) => p.saved_by_user).length,
      unread_total: states.reduce((acc, s) => acc + s.unread_count, 0),
      gossip_events_count: store.gossip.length,
      active_world_events_count: store.worldEvents.filter(
        (we) =>
          (we.status === "pending" || we.status === "accepted") &&
          (we.event_type === "invite" || we.event_type === "emotional_hook")
      ).length,
      slot_meta: TIME_SLOT_META[store.user.current_slot],
      runtime: rt,
    });
  }

  if (pathname === "/api/v1/me" && method === "PATCH") {
    if (!store.user) return jsonRes({ error: "Onboarding required" }, 401);
    const body = await readJsonBody(init);
    store.user = {
      ...store.user,
      display_name: typeof body.display_name === "string" && body.display_name.trim() ? body.display_name.trim() : store.user.display_name,
      bio: typeof body.bio === "string" ? body.bio.trim() : store.user.bio,
      context_tag: typeof body.context_tag === "string" && body.context_tag.trim() ? body.context_tag.trim() : store.user.context_tag,
      avatar_url: body.avatar_url !== undefined ? (body.avatar_url as string | null) : store.user.avatar_url,
      last_active_at: nowIso(),
    };
    saveStore(store);
    return jsonRes({ user: store.user });
  }

  // 2. /api/v1/onboarding
  if (pathname === "/api/v1/onboarding" && method === "POST") {
    const body = await readJsonBody(init);
    const displayName = String(body.display_name || "").trim();
    const rawHandle = String(body.handle || "").trim();
    if (displayName.length < 2 || rawHandle.length < 2) {
      return jsonRes({ error: "Enter a display name and username to continue." }, 400);
    }
    const cleanHandle = rawHandle.startsWith("@")
      ? rawHandle.toLowerCase().replace(/[^a-z0-9._@]/g, "")
      : `@${rawHandle.toLowerCase().replace(/[^a-z0-9._]/g, "")}`;

    const fresh = emptyStore();
    fresh.settings = store.settings;
    fresh.user = {
      id: uid(),
      handle: cleanHandle,
      display_name: displayName,
      bio: String(body.bio || "").trim(),
      context_tag: String(body.context_tag || "undergrad").trim(),
      avatar_url: null,
      energy: 20,
      max_energy: 20,
      energy_reset_at: nowIso(),
      plan_tier: "free",
      gold_balance: 0,
      current_day: 1,
      current_slot: "afternoon",
      last_active_at: nowIso(),
      created_at: nowIso(),
    };

    for (const p of PERSONA_ROWS) {
      fresh.states[p.id] = {
        persona_id: p.id,
        affinity: 0,
        trust: 0,
        romantic_tension: 0,
        current_mood: "chill",
        internal_thought: getInitialThought(p.id, 0),
        relationship_stage: "stranger",
        unread_count: 0,
        user_follows: false,
        persona_follows_back: false,
        is_close_friend: false,
        persona_added_close_friend: false,
        is_rival: false,
        dm_turns_count: 0,
        dm_last_seen_at: null,
        last_interaction_at: null,
        updated_at: nowIso(),
      };
    }

    const starterIds = ["chloe", "theo", "bella", "lucas", "maya"];
    const starterPosts: Record<string, StoredPost> = {};
    starterIds.forEach((pid, idx) => {
      const persona = PERSONA_MAP[pid];
      if (persona) {
        starterPosts[pid] = createBotPost(fresh, persona, -(idx + 1) * 25 * 60 * 1000);
      }
    });

    const starterComments: Array<{ authorId: string; commenterId: string; body: string }> = [
      { authorId: "chloe", commenterId: "leo", body: "bring notes to foundry later, I'll quiz you over coffee" },
      { authorId: "chloe", commenterId: "nina", body: "fourth floor library has quiet tables open rn btw" },
      { authorId: "theo", commenterId: "brody", body: "west terrace view never misses fr" },
      { authorId: "bella", commenterId: "jade", body: "the lighting here is actually so clean ✨" },
      { authorId: "lucas", commenterId: "parker", body: "bro go to sleep before 8am lab tomorrow lol" },
    ];
    for (const sc of starterComments) {
      const post = starterPosts[sc.authorId];
      if (post) {
        fresh.comments.push({
          id: uid(),
          post_id: post.id,
          parent_comment_id: null,
          author_type: "persona",
          author_persona_id: sc.commenterId,
          body: sc.body,
          likes_count: 3,
          created_at: nowIso(-10 * 60 * 1000),
        });
      }
    }

    ensureCampusStoriesAndNotes(fresh, 6);
    saveStore(fresh);

    return jsonRes({
      user: fresh.user,
      initialized_personas: PERSONA_ROWS.length,
      welcome_dms_scheduled: 0,
      cold_start: true,
    });
  }

  // All remaining routes except /api/v1/dev/settings require active user
  if (pathname === "/api/v1/dev/settings") {
    if (method === "GET") {
      const s = store.settings;
      const eff = effectiveRuntime(s);
      return jsonRes({
        llm_provider: s.llm_provider,
        effective_mode: eff.llm_mode,
        image_mode: eff.image_mode,
        tts_mode: eff.tts_mode,
        has_gemini_key: Boolean(s.gemini_api_key.trim()),
        has_openai_key: Boolean(s.llm_api_key.trim()),
        has_fallback_key: false,
        fallback_model: "",
        has_image_key: Boolean(s.image_api_key.trim() || s.gemini_api_key.trim()),
        has_elevenlabs_key: Boolean(s.elevenlabs_api_key.trim()),
        has_tts_key: Boolean(s.tts_api_key.trim()),
        gemini_roleplay_model: s.gemini_roleplay_model,
        gemini_fast_model: s.gemini_fast_model,
        gemini_embedding_model: s.gemini_embedding_model,
        llm_base_url: s.llm_base_url,
        llm_roleplay_model: s.llm_roleplay_model,
        llm_fast_model: s.llm_fast_model,
        image_provider: s.image_provider,
        image_base_url: s.image_base_url,
        image_model: s.image_model,
        tts_provider: s.tts_provider,
        elevenlabs_model: s.elevenlabs_model,
        gemini_tts_model: s.gemini_tts_model,
        tts_base_url: s.tts_base_url,
        tts_model: s.tts_model,
        media_video_endpoint: s.media_video_endpoint,
        speed_multiplier: s.speed_multiplier,
      });
    }
    if (method === "POST") {
      const d = await readJsonBody(init);
      const s = store.settings;
      if (d.llm_provider === "gemini" || d.llm_provider === "openai_compatible") s.llm_provider = d.llm_provider;
      if (typeof d.gemini_api_key === "string") s.gemini_api_key = d.gemini_api_key;
      if (typeof d.gemini_roleplay_model === "string") s.gemini_roleplay_model = d.gemini_roleplay_model;
      if (typeof d.gemini_fast_model === "string") s.gemini_fast_model = d.gemini_fast_model;
      if (typeof d.llm_base_url === "string") s.llm_base_url = d.llm_base_url;
      if (typeof d.llm_api_key === "string") s.llm_api_key = d.llm_api_key;
      if (typeof d.llm_roleplay_model === "string") s.llm_roleplay_model = d.llm_roleplay_model;
      if (typeof d.llm_fast_model === "string") s.llm_fast_model = d.llm_fast_model;
      if (typeof d.speed_multiplier === "number") s.speed_multiplier = clamp(d.speed_multiplier, 1, 30);

      if (store.user && (d.plan_tier === "free" || d.plan_tier === "pro")) {
        const nextMax = d.plan_tier === "pro" ? 100 : 20;
        store.user.plan_tier = d.plan_tier;
        store.user.max_energy = nextMax;
        store.user.energy = Math.max(store.user.energy, nextMax);
      }

      let boostedTier = null;
      if (store.user && d.boost_persona && typeof d.boost_persona === "object") {
        const bp = d.boost_persona as { persona_id: string; affinity: number; trust?: number; romantic_tension?: number };
        const st = store.states[bp.persona_id];
        if (st) {
          st.affinity = clamp(bp.affinity, 0, 100);
          st.trust = clamp(bp.trust ?? Math.round(st.affinity * 0.85), 0, 100);
          st.romantic_tension = clamp(bp.romantic_tension ?? 0, 0, 100);
          st.relationship_stage = computeRelationshipStage(st.affinity, st.romantic_tension);
          if (st.affinity >= 18) st.persona_follows_back = true;
          boostedTier = getMediaUnlockTier(st.affinity, st.romantic_tension);
        }
      }

      if (d.reset_world === true) {
        const preservedSettings = store.settings;
        const fresh = emptyStore();
        fresh.settings = preservedSettings;
        saveStore(fresh);
        return jsonRes({ reset: true });
      }

      saveStore(store);
      const eff = effectiveRuntime(s);
      return jsonRes({
        ok: true,
        effective_mode: eff.llm_mode,
        image_mode: eff.image_mode,
        tts_mode: eff.tts_mode,
        llm_provider: s.llm_provider,
        speed_multiplier: s.speed_multiplier,
        boosted_tier: boostedTier,
      });
    }
  }

  if (!store.user) {
    return jsonRes({ error: "Onboarding required" }, 401);
  }
  const user = store.user;

  // 3. GET /api/v1/feed
  if (pathname === "/api/v1/feed" && method === "GET") {
    const limit = Math.min(50, Math.max(5, Number(url.searchParams.get("limit") || "20")));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));
    const authorFilter = url.searchParams.get("author");
    const personaFilter = url.searchParams.get("persona_id");
    const savedOnly = url.searchParams.get("saved") === "true";

    let filtered = [...store.posts];
    if (savedOnly) {
      filtered = filtered.filter((p) => p.saved_by_user);
    } else if (authorFilter === "user") {
      filtered = filtered.filter((p) => p.author_type === "user");
    } else if (personaFilter) {
      filtered = filtered.filter((p) => p.author_persona_id === personaFilter);
    }

    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const sliced = filtered.slice(offset, offset + limit);

    const posts = sliced.map((p) => {
      const persona = p.author_persona_id ? PERSONA_MAP[p.author_persona_id] : null;
      const state = p.author_persona_id ? store.states[p.author_persona_id] : null;
      const rawComments = store.comments
        .filter((c) => c.post_id === p.id)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((c) => formatCommentNode(c, user));
      const byId = new Map(rawComments.map((c) => [c.id, c]));
      const roots: typeof rawComments = [];
      for (const c of rawComments) {
        if (c.parent_comment_id && byId.has(c.parent_comment_id)) {
          byId.get(c.parent_comment_id)!.replies.push(c);
        } else {
          roots.push(c);
        }
      }

      const likerHandles = p.liked_by_personas
        .map((pid) => PERSONA_MAP[pid]?.handle.replace(/^@/, ""))
        .filter((h): h is string => Boolean(h))
        .slice(0, 3);

      return {
        id: p.id,
        author_type: p.author_type,
        author_persona_id: p.author_persona_id,
        author_name: p.author_type === "user" ? user.display_name : persona?.display_name || "Campus Student",
        author_handle: p.author_type === "user" ? user.handle : persona?.handle || "@campus",
        author_avatar: p.author_type === "user" ? user.avatar_url : persona?.avatar_url || null,
        author_accent: p.author_type === "user" ? "#5E5CE6" : persona?.accent_color || "#5E5CE6",
        author_clique: p.author_type === "user" ? user.context_tag : persona?.clique || "campus",
        body: p.body,
        image_url: withBasePath(p.media_urls[0] || p.image_url),
        media_urls: (p.media_urls.length > 0 ? p.media_urls : p.image_url ? [p.image_url] : []).map(
          (u) => withBasePath(u) || u
        ),
        location_tag: p.location_tag,
        audience: p.audience || "campus",
        liked_by_user: p.liked_by_user,
        saved_by_user: p.saved_by_user,
        user_follows_author: Boolean(state?.user_follows),
        liked_by_handles: likerHandles,
        image_caption_ai: p.image_caption_ai,
        likes_count: p.likes_count,
        views_count: p.views_count,
        created_at: p.created_at,
        comments: roots,
      };
    });

    return jsonRes({
      posts,
      lazy_generated: false,
      current_day: user.current_day,
      current_slot: user.current_slot,
    });
  }

  // 4. POST /api/v1/posts
  if (pathname === "/api/v1/posts" && method === "POST") {
    const body = await readJsonBody(init);
    const text = String(body.body || "").trim();
    if (!text) return jsonRes({ error: "Post cannot be empty" }, 400);
    if (user.energy < 1) {
      return jsonRes(
        { error: "Out of daily energy! Advance +24h in Settings or switch to Pro.", energy: user.energy, max_energy: user.max_energy },
        429
      );
    }
    user.energy = Math.max(0, user.energy - 1);

    const mediaUrls = Array.isArray(body.media_urls) && body.media_urls.length > 0
      ? body.media_urls.map(String)
      : typeof body.image_url === "string" && body.image_url.trim()
        ? [body.image_url.trim()]
        : [];
    const primaryImage = mediaUrls[0] || null;
    const captionAi = primaryImage ? mockImageCaption(primaryImage, text) : null;

    const post: StoredPost = {
      id: uid(),
      author_type: "user",
      author_persona_id: null,
      body: text,
      image_url: primaryImage,
      media_urls: mediaUrls,
      location_tag: typeof body.location_tag === "string" && body.location_tag.trim() ? body.location_tag.trim() : null,
      audience: body.audience === "close_friends" ? "close_friends" : "campus",
      liked_by_user: false,
      liked_by_personas: [],
      saved_by_user: false,
      saved_at: null,
      image_caption_ai: captionAi,
      likes_count: 0,
      views_count: 3,
      created_at: nowIso(),
    };
    store.posts.unshift(post);
    saveStore(store);

    // Schedule 2 realistic campus reactions (likes + comments)
    const commenters = PERSONA_ROWS.filter((p) => {
      const st = store.states[p.id];
      return st && (st.user_follows || st.affinity >= 10 || p.id === "chloe" || p.id === "leo");
    }).slice(0, 2);

    commenters.forEach((persona, idx) => {
      setTimeout(() => {
        const s = loadStore();
        if (!s.user) return;
        const target = s.posts.find((p) => p.id === post.id);
        if (!target) return;
        if (!target.liked_by_personas.includes(persona.id)) {
          target.liked_by_personas.push(persona.id);
          target.likes_count += 1;
          target.views_count += 5;
          emitEvent("feed:likes_bump", {
            post_id: target.id,
            likes_count: target.likes_count,
            views_count: target.views_count,
          });
        }
        const st = s.states[persona.id];
        const draft = mockFeedComment({
          persona,
          user: s.user,
          postBody: target.body,
          isUserPost: true,
          state: {
            affinity: st?.affinity ?? 0,
            trust: st?.trust ?? 0,
            romantic_tension: st?.romantic_tension ?? 0,
            current_mood: st?.current_mood ?? "chill",
            internal_thought: st?.internal_thought ?? "",
            relationship_stage: st?.relationship_stage ?? "stranger",
          },
        });
        if (draft.comment) {
          const newComment: StoredComment = {
            id: uid(),
            post_id: target.id,
            parent_comment_id: null,
            author_type: "persona",
            author_persona_id: persona.id,
            body: draft.comment,
            likes_count: 0,
            created_at: nowIso(),
          };
          s.comments.push(newComment);
          updatePersonaState(s, persona.id, { affinityDelta: 2 });
          saveStore(s);
          emitEvent("feed:comment", {
            post_id: target.id,
            comment: formatCommentNode(newComment, s.user),
          });
          emitEvent("notification:push", {
            title: persona.display_name,
            body: `commented: "${draft.comment}"`,
            route: "/feed",
          });
        } else {
          saveStore(s);
        }
      }, scaledDelay(3500 + idx * 4500, 1200));
    });

    return jsonRes(
      {
        post: {
          ...post,
          author_name: user.display_name,
          author_handle: user.handle,
          author_avatar: user.avatar_url,
          author_accent: "#5E5CE6",
          author_clique: user.context_tag,
          user_follows_author: false,
          liked_by_handles: [],
          comments: [],
        },
        energy: user.energy,
        max_energy: user.max_energy,
      },
      201
    );
  }

  // 5. Post sub-routes: /api/v1/posts/:id/(like|save|comments|share)
  const postMatch = pathname.match(/^\/api\/v1\/posts\/([^/]+)\/(like|save|comments|share)$/);
  if (postMatch && method === "POST") {
    const [, postId, action] = postMatch;
    const post = store.posts.find((p) => p.id === postId);
    if (!post) return jsonRes({ error: "Post not found" }, 404);

    if (action === "like") {
      post.liked_by_user = !post.liked_by_user;
      post.likes_count = Math.max(0, post.likes_count + (post.liked_by_user ? 1 : -1));
      if (post.liked_by_user && post.author_persona_id) {
        updatePersonaState(store, post.author_persona_id, { affinityDelta: 1 });
      }
      saveStore(store);
      emitEvent("feed:likes_bump", {
        post_id: post.id,
        likes_count: post.likes_count,
        views_count: post.views_count,
      });
      return jsonRes({
        liked: post.liked_by_user,
        liked_by_user: post.liked_by_user,
        likes_count: post.likes_count,
        views_count: post.views_count,
      });
    }

    if (action === "save") {
      post.saved_by_user = !post.saved_by_user;
      post.saved_at = post.saved_by_user ? nowIso() : null;
      saveStore(store);
      return jsonRes({ saved: post.saved_by_user, post_id: post.id });
    }

    if (action === "comments") {
      const body = await readJsonBody(init);
      const commentText = String(body.body || "").trim();
      if (!commentText) return jsonRes({ error: "Comment cannot be empty" }, 400);
      const parentId = typeof body.parent_comment_id === "string" ? body.parent_comment_id : null;
      const parent = parentId ? store.comments.find((c) => c.id === parentId) : null;

      const created: StoredComment = {
        id: uid(),
        post_id: post.id,
        parent_comment_id: parent?.id ?? null,
        author_type: "user",
        author_persona_id: null,
        body: commentText,
        likes_count: 0,
        created_at: nowIso(),
      };
      store.comments.push(created);
      const payload = formatCommentNode(created, user);

      const responderId = parent?.author_persona_id || post.author_persona_id;
      if (responderId && PERSONA_MAP[responderId]) {
        updatePersonaState(store, responderId, { affinityDelta: 2 });
        const responder = PERSONA_MAP[responderId];
        setTimeout(() => {
          const s = loadStore();
          if (!s.user) return;
          const st = s.states[responder.id];
          const draft = mockFeedComment({
            persona: responder,
            user: s.user,
            postBody: post.body,
            isUserPost: post.author_type === "user",
            state: {
              affinity: st?.affinity ?? 0,
              trust: st?.trust ?? 0,
              romantic_tension: st?.romantic_tension ?? 0,
              current_mood: st?.current_mood ?? "chill",
              internal_thought: st?.internal_thought ?? "",
              relationship_stage: st?.relationship_stage ?? "stranger",
            },
            parentComment: { authorName: s.user.display_name, body: commentText },
          });
          if (draft.comment) {
            const reply: StoredComment = {
              id: uid(),
              post_id: post.id,
              parent_comment_id: created.id,
              author_type: "persona",
              author_persona_id: responder.id,
              body: draft.comment,
              likes_count: 0,
              created_at: nowIso(),
            };
            s.comments.push(reply);
            saveStore(s);
            emitEvent("feed:comment", { post_id: post.id, comment: formatCommentNode(reply, s.user) });
            emitEvent("notification:push", {
              title: responder.display_name,
              body: `replied: "${draft.comment}"`,
              route: "/feed",
            });
          }
        }, scaledDelay(4500, 1200));
      }

      saveStore(store);
      emitEvent("feed:comment", { post_id: post.id, comment: payload });
      return jsonRes({ comment: payload, reply_scheduled_for: responderId || null }, 201);
    }

    if (action === "share") {
      const body = await readJsonBody(init);
      const personaId = String(body.persona_id || "");
      const note = String(body.note || "").trim();
      const persona = PERSONA_MAP[personaId];
      if (!persona) return jsonRes({ error: "Recipient not found" }, 404);

      const postAuthor = post.author_persona_id ? PERSONA_MAP[post.author_persona_id] : null;
      const authorHandle = post.author_type === "user" ? user.handle : postAuthor?.handle || "@campus";
      const msg: StoredDmMessage = {
        id: uid(),
        persona_id: persona.id,
        sender_type: "user",
        message_type: "post_share",
        body: note || post.body.slice(0, 120),
        media_url: withBasePath(post.image_url),
        media_metadata: {
          shared_post_id: post.id,
          shared_author_handle: authorHandle,
          shared_author_name: post.author_type === "user" ? user.display_name : postAuthor?.display_name,
          shared_body: post.body,
        },
        reaction: null,
        reply_to_message_id: null,
        read_at: null,
        bubble_group_id: null,
        created_at: nowIso(),
      };
      store.messages.push(msg);

      const st = store.states[persona.id];
      const dmOut = mockDmResponse({
        persona,
        user,
        state: {
          affinity: st?.affinity ?? 0,
          trust: st?.trust ?? 0,
          romantic_tension: st?.romantic_tension ?? 0,
          current_mood: st?.current_mood ?? "chill",
          internal_thought: st?.internal_thought ?? "",
          relationship_stage: st?.relationship_stage ?? "stranger",
        },
        userMessage: note ? `${note} — shared ${authorHandle}'s post: "${post.body}"` : `Shared ${authorHandle}'s post: "${post.body}"`,
        messageType: "post_share",
        historyLength: 0,
        retrievedMemories: [],
      });
      const updatedSt = updatePersonaState(store, persona.id, {
        affinityDelta: dmOut.affinity_delta,
        newMood: dmOut.new_mood,
        internalThought: dmOut.internal_thought,
        incrementDmTurns: true,
      });
      const gated = enforceMediaAttachmentPolicy(
        dmOut.media_attachment,
        updatedSt.affinity,
        updatedSt.romantic_tension
      );
      saveStore(store);
      schedulePersonaReply({
        persona,
        bubbles: dmOut.bubbles,
        mediaAttachment: gated.attachment,
        reactEmoji: dmOut.react_emoji,
        reactTargetId: msg.id,
        pushNotification: true,
        incrementUnread: true,
      });
      return jsonRes({ ok: true, shared_to: persona.id, message: msg });
    }
  }

  // 6. Stories: GET/POST /api/v1/stories & POST /api/v1/stories/:id/interact
  if (pathname === "/api/v1/stories" && method === "GET") {
    ensureCampusStoriesAndNotes(store, 6);
    saveStore(store);

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

    for (const s of [...store.stories].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )) {
      const key = s.author_type === "user" ? "user" : s.author_persona_id || s.id;
      const persona = s.author_persona_id ? PERSONA_MAP[s.author_persona_id] : null;
      let group = groupsMap.get(key);
      if (!group) {
        group = {
          author_key: key,
          author_type: s.author_type,
          author_persona_id: s.author_persona_id,
          author_name: s.author_type === "user" ? user.display_name : persona?.display_name || "Campus Student",
          author_handle:
            s.author_type === "user"
              ? user.handle.replace(/^@/, "")
              : (persona?.handle || "campus").replace(/^@/, ""),
          author_avatar: s.author_type === "user" ? user.avatar_url : persona?.avatar_url || null,
          has_unseen: false,
          is_close_friends: false,
          slides: [],
        };
        groupsMap.set(key, group);
      }
      if (!s.viewed_by_user && s.author_type === "persona") group.has_unseen = true;
      if (s.audience === "close_friends") group.is_close_friends = true;
      group.slides.push({
        id: s.id,
        media_url: withBasePath(s.media_url) || s.media_url,
        caption: s.caption,
        audience: s.audience,
        viewed_by_user: s.viewed_by_user,
        liked_by_user: s.liked_by_user,
        created_at: s.created_at,
      });
    }

    const groups = Array.from(groupsMap.values()).sort((a, b) => {
      if (a.author_type === "user") return -1;
      if (b.author_type === "user") return 1;
      if (a.has_unseen !== b.has_unseen) return a.has_unseen ? -1 : 1;
      return 0;
    });

    return jsonRes({ stories: groups });
  }

  if (pathname === "/api/v1/stories" && method === "POST") {
    const body = await readJsonBody(init);
    const mediaUrl = String(body.media_url || "").trim();
    if (!mediaUrl) return jsonRes({ error: "Photo is required for a Story" }, 400);
    const story: StoredStory = {
      id: uid(),
      author_type: "user",
      author_persona_id: null,
      media_url: mediaUrl,
      caption: String(body.caption || "").trim(),
      audience: body.audience === "close_friends" ? "close_friends" : "campus",
      viewed_by_user: true,
      liked_by_user: false,
      expires_at: nowIso(24 * 60 * 60 * 1000),
      created_at: nowIso(),
    };
    store.stories.unshift(story);
    saveStore(store);
    return jsonRes({ story }, 201);
  }

  const storyMatch = pathname.match(/^\/api\/v1\/stories\/([^/]+)\/interact$/);
  if (storyMatch && method === "POST") {
    const [, storyId] = storyMatch;
    const story = store.stories.find((s) => s.id === storyId);
    if (!story) return jsonRes({ error: "Story not found" }, 404);
    const body = await readJsonBody(init);
    const action = String(body.action || "");

    if (action === "view") {
      story.viewed_by_user = true;
      saveStore(store);
      return jsonRes({ ok: true, viewed: true });
    }
    if (action === "like") {
      story.liked_by_user = !story.liked_by_user;
      story.viewed_by_user = true;
      if (story.liked_by_user && story.author_persona_id) {
        updatePersonaState(store, story.author_persona_id, { affinityDelta: 1 });
      }
      saveStore(store);
      return jsonRes({ ok: true, liked: story.liked_by_user });
    }
    if (action === "reply") {
      const replyText = String(body.reply_text || "").trim();
      if (!replyText || !story.author_persona_id) return jsonRes({ error: "Reply text is required" }, 400);
      const persona = PERSONA_MAP[story.author_persona_id];
      if (!persona) return jsonRes({ error: "Persona not found" }, 404);

      const msg: StoredDmMessage = {
        id: uid(),
        persona_id: persona.id,
        sender_type: "user",
        message_type: "story_reply",
        body: replyText,
        media_url: withBasePath(story.media_url),
        media_metadata: { story_id: story.id, story_caption: story.caption },
        reaction: null,
        reply_to_message_id: null,
        read_at: null,
        bubble_group_id: null,
        created_at: nowIso(),
      };
      store.messages.push(msg);

      const st = store.states[persona.id];
      const dmOut = mockDmResponse({
        persona,
        user,
        state: {
          affinity: st?.affinity ?? 0,
          trust: st?.trust ?? 0,
          romantic_tension: st?.romantic_tension ?? 0,
          current_mood: st?.current_mood ?? "chill",
          internal_thought: st?.internal_thought ?? "",
          relationship_stage: st?.relationship_stage ?? "stranger",
        },
        userMessage: `[Replied to your Story "${story.caption}"]: ${replyText}`,
        messageType: "story_reply",
        historyLength: 0,
        retrievedMemories: [],
      });
      const updatedSt = updatePersonaState(store, persona.id, {
        affinityDelta: dmOut.affinity_delta,
        newMood: dmOut.new_mood,
        internalThought: dmOut.internal_thought,
        incrementDmTurns: true,
      });
      const gated = enforceMediaAttachmentPolicy(
        dmOut.media_attachment,
        updatedSt.affinity,
        updatedSt.romantic_tension
      );
      saveStore(store);
      schedulePersonaReply({
        persona,
        bubbles: dmOut.bubbles,
        mediaAttachment: gated.attachment,
        reactEmoji: dmOut.react_emoji,
        reactTargetId: msg.id,
        pushNotification: true,
        incrementUnread: true,
      });
      return jsonRes({ ok: true, persona_id: persona.id, message: msg });
    }
  }

  // 7. Notes: GET/POST/DELETE /api/v1/notes
  if (pathname === "/api/v1/notes") {
    if (method === "GET") {
      ensureCampusStoriesAndNotes(store, 6);
      saveStore(store);
      const notes = [...store.notes]
        .sort((a, b) => {
          if (a.author_type !== b.author_type) return a.author_type === "user" ? -1 : 1;
          const affA = a.author_persona_id ? store.states[a.author_persona_id]?.affinity ?? 0 : 999;
          const affB = b.author_persona_id ? store.states[b.author_persona_id]?.affinity ?? 0 : 999;
          return affB - affA;
        })
        .map((n) => {
          const persona = n.author_persona_id ? PERSONA_MAP[n.author_persona_id] : null;
          return {
            id: n.id,
            author_type: n.author_type,
            author_persona_id: n.author_persona_id,
            author_name: n.author_type === "user" ? user.display_name : persona?.display_name || "Campus",
            author_handle:
              n.author_type === "user"
                ? user.handle.replace(/^@/, "")
                : (persona?.handle || "campus").replace(/^@/, ""),
            author_avatar: n.author_type === "user" ? user.avatar_url : persona?.avatar_url || null,
            body: n.body,
            created_at: n.created_at,
          };
        });
      return jsonRes({ notes });
    }
    if (method === "POST") {
      const body = await readJsonBody(init);
      const text = String(body.body || "").trim().slice(0, 60);
      if (!text) return jsonRes({ error: "Note must be 1 to 60 characters" }, 400);
      store.notes = store.notes.filter((n) => n.author_type !== "user");
      const note: StoredNote = {
        id: uid(),
        author_type: "user",
        author_persona_id: null,
        body: text,
        expires_at: nowIso(24 * 60 * 60 * 1000),
        created_at: nowIso(),
      };
      store.notes.unshift(note);
      saveStore(store);
      return jsonRes({ note }, 201);
    }
    if (method === "DELETE") {
      store.notes = store.notes.filter((n) => n.author_type !== "user");
      saveStore(store);
      return jsonRes({ ok: true });
    }
  }

  // 8. /api/v1/graph/crew
  if (pathname === "/api/v1/graph/crew" && method === "GET") {
    const crew = PERSONA_ROWS.map((p) => {
      const st = store.states[p.id];
      const connections = EDGE_SEEDS.filter((e) => e.source_id === p.id).map((e) => ({
        source_id: e.source_id,
        target_id: e.target_id,
        target_name: PERSONA_MAP[e.target_id]?.display_name || e.target_id,
        target_accent: PERSONA_MAP[e.target_id]?.accent_color || "#5E5CE6",
        relation_type: e.relation_type,
        affinity: e.affinity,
        friction: e.friction,
        gossip_trust: e.gossip_trust,
        shared_lore: e.shared_lore,
      }));
      return {
        id: p.id,
        display_name: p.display_name,
        handle: p.handle,
        clique: p.clique,
        archetype: p.archetype,
        avatar_url: p.avatar_url,
        accent_color: p.accent_color,
        age: p.age,
        bio: p.bio,
        gossip_propensity: p.gossip_propensity,
        voice_profile: p.voice_profile,
        visual_anchor: p.visual_anchor,
        activity_schedule: p.activity_schedule,
        affinity: st?.affinity ?? 0,
        trust: st?.trust ?? 0,
        romantic_tension: st?.romantic_tension ?? 0,
        current_mood: st?.current_mood ?? "chill",
        internal_thought: st?.internal_thought ?? getInitialThought(p.id, 0),
        relationship_stage: st?.relationship_stage ?? "stranger",
        unread_count: st?.unread_count ?? 0,
        user_follows: Boolean(st?.user_follows),
        persona_follows_back: Boolean(st?.persona_follows_back),
        is_close_friend: Boolean(st?.is_close_friend),
        persona_added_close_friend: Boolean(st?.persona_added_close_friend),
        dm_turns_count: st?.dm_turns_count ?? 0,
        last_interaction_at: st?.last_interaction_at ?? null,
        is_online: isPersonaOnline(p.activity_schedule, user.current_slot),
        media_tier: getMediaUnlockTier(st?.affinity ?? 0, st?.romantic_tension ?? 0),
        memories: store.memories.filter((m) => m.persona_id === p.id).slice(0, 12),
        connections,
      };
    }).sort((a, b) => b.affinity - a.affinity || a.display_name.localeCompare(b.display_name));

    return jsonRes({
      crew,
      gossip_events: store.gossip.slice(0, 20),
      total_personas: crew.length,
      total_edges: EDGE_SEEDS.length,
      current_day: user.current_day,
      current_slot: user.current_slot,
    });
  }

  // 9. /api/v1/graph/network
  if (pathname === "/api/v1/graph/network" && method === "GET") {
    const nodes = [
      {
        id: "__user__",
        label: user.display_name,
        handle: user.handle,
        clique: "user",
        accent_color: "#FFFFFF",
        affinity: 100,
        is_user: true,
      },
      ...PERSONA_ROWS.map((p) => {
        const st = store.states[p.id];
        return {
          id: p.id,
          label: p.display_name.split(" ")[0],
          full_name: p.display_name,
          handle: p.handle,
          clique: p.clique,
          archetype: p.archetype,
          accent_color: p.accent_color,
          avatar_url: p.avatar_url,
          gossip_propensity: p.gossip_propensity,
          affinity: st?.affinity ?? 0,
          romantic_tension: st?.romantic_tension ?? 0,
          current_mood: st?.current_mood ?? "chill",
          relationship_stage: st?.relationship_stage ?? "stranger",
          is_user: false,
        };
      }),
    ];

    const links = [
      ...EDGE_SEEDS.map((e) => ({
        source: e.source_id,
        target: e.target_id,
        relation_type: e.relation_type,
        affinity: e.affinity,
        friction: e.friction,
        gossip_trust: e.gossip_trust,
        shared_lore: e.shared_lore,
        is_user_link: false,
      })),
      ...PERSONA_ROWS.filter((p) => {
        const st = store.states[p.id];
        return st && (st.affinity >= 32 || st.romantic_tension >= 20 || st.relationship_stage === "rival");
      }).map((p) => {
        const st = store.states[p.id];
        return {
          source: "__user__",
          target: p.id,
          relation_type: st.relationship_stage,
          affinity: st.affinity,
          friction: st.relationship_stage === "rival" ? 0.75 : 0.15,
          gossip_trust: p.gossip_propensity,
          shared_lore: `Your current stage with ${p.display_name}: ${st.relationship_stage} (${st.affinity}/100)`,
          is_user_link: true,
        };
      }),
    ];

    return jsonRes({
      nodes,
      links,
      stats: { persona_nodes: PERSONA_ROWS.length, persona_edges: EDGE_SEEDS.length },
    });
  }

  // 10. POST /api/v1/personas/:id/follow
  const followMatch = pathname.match(/^\/api\/v1\/personas\/([^/]+)\/follow$/);
  if (followMatch && method === "POST") {
    const [, personaId] = followMatch;
    const st = store.states[personaId];
    if (!st) return jsonRes({ error: "Persona not found" }, 404);
    const body = await readJsonBody(init);
    const action = body.action === "toggle_close_friend" ? "toggle_close_friend" : "toggle_follow";

    if (action === "toggle_close_friend") {
      if (!st.is_close_friend && st.affinity < 25) {
        return jsonRes({ error: "Get to know them a little first (Affinity 25+) to add to Close Friends." }, 400);
      }
      st.is_close_friend = !st.is_close_friend;
      saveStore(store);
      return jsonRes({
        persona_id: personaId,
        user_follows: st.user_follows,
        persona_follows_back: st.persona_follows_back,
        is_close_friend: st.is_close_friend,
      });
    }

    st.user_follows = !st.user_follows;
    st.affinity = clamp(st.affinity + (st.user_follows ? 2 : -3), 0, 100);
    st.updated_at = nowIso();
    saveStore(store);

    if (st.user_follows && !st.persona_follows_back) {
      setTimeout(() => {
        const s = loadStore();
        const cur = s.states[personaId];
        const persona = PERSONA_MAP[personaId];
        if (!cur || !persona || !cur.user_follows || cur.persona_follows_back) return;
        const warm = ["chloe", "leo", "nina", "brody", "parker", "lauren"].includes(personaId);
        if (warm || cur.affinity >= 12) {
          cur.persona_follows_back = true;
          cur.updated_at = nowIso();
          saveStore(s);
          emitEvent("notification:push", {
            title: persona.display_name,
            body: "started following you back.",
            route: `/dms/${persona.id}`,
          });
        }
      }, scaledDelay(6000, 1500));
    }

    return jsonRes({
      persona_id: personaId,
      user_follows: st.user_follows,
      persona_follows_back: st.persona_follows_back,
      is_close_friend: st.is_close_friend,
    });
  }

  // 11. GET /api/v1/dms
  if (pathname === "/api/v1/dms" && method === "GET") {
    const threads = PERSONA_ROWS.map((p) => {
      const st = store.states[p.id];
      const msgs = store.messages.filter((m) => m.persona_id === p.id);
      const last = msgs[msgs.length - 1] || null;
      return {
        persona_id: p.id,
        display_name: p.display_name,
        handle: p.handle,
        clique: p.clique,
        archetype: p.archetype,
        avatar_url: p.avatar_url,
        accent_color: p.accent_color,
        activity_schedule: p.activity_schedule,
        affinity: st?.affinity ?? 0,
        trust: st?.trust ?? 0,
        romantic_tension: st?.romantic_tension ?? 0,
        current_mood: st?.current_mood ?? "chill",
        internal_thought: st?.internal_thought ?? "",
        relationship_stage: st?.relationship_stage ?? "stranger",
        unread_count: st?.unread_count ?? 0,
        last_interaction_at: st?.last_interaction_at ?? null,
        last_message_body: last?.body ?? null,
        last_message_type: last?.message_type ?? null,
        last_message_sender: last?.sender_type ?? null,
        last_message_at: last?.created_at ?? null,
        has_pending_invite: store.worldEvents.some(
          (we) => we.persona_id === p.id && we.event_type === "invite" && we.status === "pending"
        ),
        has_active_hook: store.worldEvents.some(
          (we) => we.persona_id === p.id && we.event_type === "emotional_hook" && we.status === "pending"
        ),
        is_online: isPersonaOnline(p.activity_schedule, user.current_slot),
        media_tier: getMediaUnlockTier(st?.affinity ?? 0, st?.romantic_tension ?? 0),
      };
    }).sort((a, b) => {
      if (Boolean(a.last_message_at) !== Boolean(b.last_message_at)) {
        return a.last_message_at ? -1 : 1;
      }
      if (a.last_message_at && b.last_message_at) {
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
      }
      return b.affinity - a.affinity;
    });

    return jsonRes({ threads, current_day: user.current_day, current_slot: user.current_slot });
  }

  // 12. GET /api/v1/dms/:persona_id
  const dmThreadMatch = pathname.match(/^\/api\/v1\/dms\/([^/]+)$/);
  if (dmThreadMatch && method === "GET") {
    const [, personaId] = dmThreadMatch;
    const persona = PERSONA_MAP[personaId];
    if (!persona) return jsonRes({ error: "Persona not found" }, 404);
    const st = store.states[personaId];
    if (st && st.unread_count > 0) {
      st.unread_count = 0;
      saveStore(store);
    }
    const messages = store.messages.filter((m) => m.persona_id === personaId).slice(-60);
    const worldEvents = store.worldEvents.filter((we) => we.persona_id === personaId).slice(0, 10);
    const memories = store.memories.filter((m) => m.persona_id === personaId).slice(0, 12);

    return jsonRes({
      persona: {
        id: persona.id,
        display_name: persona.display_name,
        handle: persona.handle,
        clique: persona.clique,
        archetype: persona.archetype,
        avatar_url: persona.avatar_url,
        accent_color: persona.accent_color,
        age: persona.age,
        bio: persona.bio,
        voice_profile: persona.voice_profile,
        visual_anchor: persona.visual_anchor,
        typing_style: persona.typing_style,
        is_online: isPersonaOnline(persona.activity_schedule, user.current_slot),
      },
      state: st || {
        affinity: 0,
        trust: 0,
        romantic_tension: 0,
        current_mood: "chill",
        internal_thought: "",
        relationship_stage: "stranger",
        unread_count: 0,
        user_follows: false,
        persona_follows_back: false,
        is_close_friend: false,
        persona_added_close_friend: false,
        dm_turns_count: 0,
        dm_last_seen_at: null,
        last_interaction_at: null,
      },
      media_tier: getMediaUnlockTier(st?.affinity ?? 0, st?.romantic_tension ?? 0),
      messages,
      world_events: worldEvents,
      memories,
      current_day: user.current_day,
      current_slot: user.current_slot,
    });
  }

  // 13. POST /api/v1/dms/:persona_id/messages
  const dmMsgMatch = pathname.match(/^\/api\/v1\/dms\/([^/]+)\/messages$/);
  if (dmMsgMatch && method === "POST") {
    const [, personaId] = dmMsgMatch;
    const persona = PERSONA_MAP[personaId];
    if (!persona) return jsonRes({ error: "Persona not found" }, 404);
    const body = await readJsonBody(init);
    const messageType = (body.message_type as StoredDmMessage["message_type"]) || "text";
    const mediaUrl = typeof body.media_url === "string" && body.media_url.trim() ? body.media_url.trim() : null;
    const messageBody =
      messageType === "screenshot_alert"
        ? String(body.body || `${user.display_name} took a screenshot of this chat!`)
        : messageType === "image"
          ? String(body.body || "Sent a photo")
          : String(body.body || "").trim();

    if (messageType === "text" && !messageBody) {
      return jsonRes({ error: "Message text cannot be empty" }, 400);
    }

    if (messageType === "text" || messageType === "image") {
      if (user.energy < 1) {
        return jsonRes(
          { error: "Out of daily energy! Advance +24h or +6h in Settings.", energy: user.energy, max_energy: user.max_energy },
          429
        );
      }
      user.energy = Math.max(0, user.energy - 1);
    }

    const replyToId = typeof body.reply_to_message_id === "string" ? body.reply_to_message_id : null;
    const replyTarget = replyToId ? store.messages.find((m) => m.id === replyToId) : null;
    const imageCaption = messageType === "image" && mediaUrl ? mockImageCaption(mediaUrl, messageBody) : null;

    const userMsg: StoredDmMessage = {
      id: uid(),
      persona_id: persona.id,
      sender_type: messageType === "screenshot_alert" ? "system" : "user",
      message_type: messageType,
      body: messageBody,
      media_url: mediaUrl,
      media_metadata: {
        ...((body.media_metadata as Record<string, unknown>) || {}),
        ...(imageCaption ? { vision_caption: imageCaption } : {}),
        ...(replyTarget ? { reply_preview: replyTarget.body.slice(0, 90), reply_sender: replyTarget.sender_type } : {}),
      },
      reaction: null,
      reply_to_message_id: replyTarget?.id ?? null,
      read_at: null,
      bubble_group_id: null,
      created_at: nowIso(),
    };
    store.messages.push(userMsg);

    const st = store.states[persona.id] || updatePersonaState(store, persona.id, {});
    const history = store.messages
      .filter((m) => m.persona_id === persona.id)
      .slice(-15)
      .map((m) => ({ sender_type: m.sender_type, message_type: m.message_type, body: m.body }));

    const activeHook = store.worldEvents.find(
      (we) => we.persona_id === persona.id && we.event_type === "emotional_hook" && we.status === "pending"
    );

    const mockMsgType: "text" | "image" | "screenshot_alert" | "story_reply" | "note_reply" | "post_share" =
      messageType === "image" ||
      messageType === "screenshot_alert" ||
      messageType === "story_reply" ||
      messageType === "note_reply" ||
      messageType === "post_share"
        ? messageType
        : "text";

    const mockOut = mockDmResponse({
      persona,
      user,
      state: {
        affinity: st.affinity,
        trust: st.trust,
        romantic_tension: st.romantic_tension,
        current_mood: st.current_mood,
        internal_thought: st.internal_thought,
        relationship_stage: st.relationship_stage,
      },
      userMessage: messageBody,
      messageType: mockMsgType,
      imageCaption,
      historyLength: history.length,
      retrievedMemories: store.memories
        .filter((m) => m.persona_id === persona.id)
        .slice(0, 5)
        .map((m) => ({ fact: m.fact, category: m.category, source_type: m.source_type, leaked_by_persona: m.leaked_by_persona })),
      activeEmotionalHook: activeHook ? { title: activeHook.title, description: activeHook.description } : null,
    });

    const liveOut = await tryLiveBrowserLlmDm(nativeFetch, store.settings, persona, user, st, history, messageBody);
    const bubbles = liveOut?.bubbles || mockOut.bubbles;

    let hookBonusAffinity = 0;
    let hookBonusTrust = 0;
    let resolvedHookTitle: string | null = null;
    if (activeHook && (messageType === "text" || messageType === "image")) {
      activeHook.status = "completed";
      hookBonusAffinity = Math.max(4, Math.round(activeHook.reward_affinity * 0.5));
      hookBonusTrust = 10;
      resolvedHookTitle = activeHook.title;
      emitEvent("world:update", { reason: "emotional_hook_completed" });
    }

    const updatedState = updatePersonaState(store, persona.id, {
      affinityDelta: mockOut.affinity_delta + hookBonusAffinity,
      trustDelta: (mockOut.affinity_delta > 0 ? 2 : mockOut.affinity_delta < -2 ? -2 : 0) + hookBonusTrust,
      romanticDelta: mockOut.romantic_delta,
      newMood: liveOut?.mood || mockOut.new_mood,
      internalThought: mockOut.internal_thought,
      incrementDmTurns: messageType !== "screenshot_alert",
    });

    const gated = enforceMediaAttachmentPolicy(
      mockOut.media_attachment,
      updatedState.affinity,
      updatedState.romantic_tension
    );

    if (messageType !== "screenshot_alert") {
      const memOut = mockExtractMemories({
        recentMessages: [messageBody],
        existingMemories: store.memories
          .filter((m) => m.persona_id === persona.id)
          .slice(0, 20)
          .map((m) => m.fact),
      });
      for (const m of memOut.new_facts.slice(0, 2)) {
        store.memories.unshift({
          id: uid(),
          persona_id: persona.id,
          fact: m.fact,
          category: m.category,
          importance: m.importance,
          source_type: "direct",
          leaked_by_persona: null,
          created_at: nowIso(),
        });
      }
    }

    if (mockOut.gossip_candidate && mockOut.gossip_candidate.juiciness >= 6) {
      triggerGossipCascade(store, persona.id, mockOut.gossip_candidate.summary, mockOut.gossip_candidate.juiciness);
    }

    saveStore(store);

    schedulePersonaReply({
      persona,
      bubbles,
      mediaAttachment: gated.attachment,
      reactEmoji: mockOut.react_emoji ?? null,
      reactTargetId: userMsg.id,
      pushNotification: false,
      incrementUnread: false,
    });

    return jsonRes(
      {
        user_message: userMsg,
        streaming_via_sse: true,
        expected_bubbles: bubbles.length + (gated.attachment ? 1 : 0),
        state: updatedState,
        media_tier: getMediaUnlockTier(updatedState.affinity, updatedState.romantic_tension),
        media_blocked_reason: gated.blockedReason,
        gossip_scheduled: Boolean(mockOut.gossip_candidate && mockOut.gossip_candidate.juiciness >= 6),
        gossip_candidate: mockOut.gossip_candidate ?? null,
        resolved_hook: resolvedHookTitle,
        provider_used: liveOut ? effectiveRuntime(store.settings).llm_mode : "mock",
        energy: user.energy,
        max_energy: user.max_energy,
      },
      202
    );
  }

  // 14. POST /api/v1/dms/:persona_id/messages/:message_id/(react|view)
  const dmActionMatch = pathname.match(/^\/api\/v1\/dms\/([^/]+)\/messages\/([^/]+)\/(react|view)$/);
  if (dmActionMatch && method === "POST") {
    const [, personaId, messageId, action] = dmActionMatch;
    const msg = store.messages.find((m) => m.id === messageId && m.persona_id === personaId);
    if (!msg) return jsonRes({ error: "Message not found" }, 404);

    if (action === "react") {
      const body = await readJsonBody(init);
      const emoji = typeof body.emoji === "string" ? body.emoji : null;
      msg.reaction = msg.reaction === emoji ? null : emoji;
      saveStore(store);
      emitEvent("dm:reaction", { persona_id: personaId, message_id: messageId, reaction: msg.reaction });
      return jsonRes({ id: msg.id, reaction: msg.reaction });
    }
    if (action === "view") {
      const viewedAt = nowIso();
      msg.media_metadata = { ...(msg.media_metadata || {}), viewed_at: viewedAt };
      saveStore(store);
      return jsonRes({ id: msg.id, viewed_at: viewedAt, media_metadata: msg.media_metadata });
    }
  }

  // 15. GET /api/v1/activity
  if (pathname === "/api/v1/activity" && method === "GET") {
    const items: Array<Record<string, unknown>> = [];

    for (const st of Object.values(store.states)) {
      if (!st.persona_follows_back) continue;
      const p = PERSONA_MAP[st.persona_id];
      if (!p) continue;
      items.push({
        id: `follow-${p.id}`,
        kind: "follow",
        persona_id: p.id,
        persona_name: p.display_name,
        persona_handle: p.handle.replace(/^@/, ""),
        persona_avatar: p.avatar_url,
        text: "started following you.",
        created_at: st.updated_at,
        route: `/dms/${p.id}`,
      });
    }

    const slotCounts = new Map<string, number>();
    for (const we of store.worldEvents) {
      if (we.event_type === "invite" && (we.status === "pending" || we.status === "accepted")) {
        const key = `${we.scheduled_day}:${we.scheduled_slot}`;
        slotCounts.set(key, (slotCounts.get(key) || 0) + 1);
      }
    }

    for (const we of store.worldEvents) {
      if (we.event_type !== "invite" && we.event_type !== "emotional_hook") continue;
      const p = PERSONA_MAP[we.persona_id];
      if (!p) continue;
      const slotMeta = TIME_SLOT_META[we.scheduled_slot];
      const key = `${we.scheduled_day}:${we.scheduled_slot}`;
      const hasConflict =
        we.event_type === "invite" &&
        (we.status === "pending" || we.status === "accepted") &&
        (slotCounts.get(key) || 0) > 1;
      items.push({
        id: `we-${we.id}`,
        kind: we.event_type === "emotional_hook" ? "emotional_hook" : "invite",
        persona_id: p.id,
        persona_name: p.display_name,
        persona_handle: p.handle.replace(/^@/, ""),
        persona_avatar: p.avatar_url,
        text: we.event_type === "emotional_hook" ? `reached out late: ${we.title}` : `invited you to ${we.title}`,
        subtext:
          we.event_type === "emotional_hook"
            ? we.description
            : `Day ${we.scheduled_day} · ${slotMeta?.label || we.scheduled_slot}${hasConflict ? " · Schedule conflict" : ""}`,
        created_at: we.created_at,
        route: `/dms/${p.id}`,
        world_event: {
          id: we.id,
          title: we.title,
          status: we.status,
          scheduled_day: we.scheduled_day,
          scheduled_slot: we.scheduled_slot,
          slot_label: slotMeta?.label || we.scheduled_slot,
          reward_affinity: we.reward_affinity,
          has_conflict: hasConflict,
        },
      });
    }

    for (const c of store.comments) {
      if (c.author_type !== "persona" || !c.author_persona_id) continue;
      const post = store.posts.find((p) => p.id === c.post_id);
      const parent = c.parent_comment_id ? store.comments.find((pc) => pc.id === c.parent_comment_id) : null;
      if (!post || (post.author_type !== "user" && parent?.author_type !== "user")) continue;
      const p = PERSONA_MAP[c.author_persona_id];
      if (!p) continue;
      items.push({
        id: `c-${c.id}`,
        kind: "comment",
        persona_id: p.id,
        persona_name: p.display_name,
        persona_handle: p.handle.replace(/^@/, ""),
        persona_avatar: p.avatar_url,
        text: c.parent_comment_id ? `replied to your comment: "${c.body}"` : `commented: "${c.body}"`,
        created_at: c.created_at,
        route: "/feed",
        post_thumbnail: { post_id: post.id, image_url: withBasePath(post.image_url), body: post.body },
      });
    }

    for (const g of store.gossip) {
      if (g.reached_personas.length === 0) continue;
      const p = PERSONA_MAP[g.origin_persona_id];
      if (!p) continue;
      items.push({
        id: `g-${g.id}`,
        kind: "gossip",
        persona_id: p.id,
        persona_name: p.display_name,
        persona_handle: p.handle.replace(/^@/, ""),
        persona_avatar: p.avatar_url,
        text: `talked about your secret with ${g.reached_personas.join(", ")}.`,
        subtext: g.summary,
        created_at: g.created_at,
        route: "/crew",
      });
    }

    items.sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());
    return jsonRes({
      items,
      pending_invites_count: items.filter((i) => i.kind === "invite" && (i.world_event as { status?: string })?.status === "pending").length,
      pending_hooks_count: items.filter((i) => i.kind === "emotional_hook" && (i.world_event as { status?: string })?.status === "pending").length,
    });
  }

  // 16. GET /api/v1/world-events
  if (pathname === "/api/v1/world-events" && method === "GET") {
    const slotCounts = new Map<string, number>();
    for (const ev of store.worldEvents) {
      if (ev.event_type === "invite" && (ev.status === "pending" || ev.status === "accepted")) {
        const key = `${ev.scheduled_day}:${ev.scheduled_slot}`;
        slotCounts.set(key, (slotCounts.get(key) || 0) + 1);
      }
    }
    const events = store.worldEvents.map((ev) => {
      const p = PERSONA_MAP[ev.persona_id];
      const key = `${ev.scheduled_day}:${ev.scheduled_slot}`;
      return {
        ...ev,
        persona_name: p?.display_name || ev.persona_id,
        persona_handle: p?.handle || `@${ev.persona_id}`,
        persona_avatar: p?.avatar_url || null,
        persona_accent: p?.accent_color || "#5E5CE6",
        slot_label: TIME_SLOT_META[ev.scheduled_slot]?.label || ev.scheduled_slot,
        slot_emoji: TIME_SLOT_META[ev.scheduled_slot]?.emoji || "🗓️",
        has_conflict:
          ev.event_type === "invite" &&
          (ev.status === "pending" || ev.status === "accepted") &&
          (slotCounts.get(key) || 0) > 1,
      };
    });
    return jsonRes({
      events,
      current_day: user.current_day,
      current_slot: user.current_slot,
      slot_meta: TIME_SLOT_META[user.current_slot],
    });
  }

  // 17. POST /api/v1/world-events/:id/respond
  const weRespondMatch = pathname.match(/^\/api\/v1\/world-events\/([^/]+)\/respond$/);
  if (weRespondMatch && method === "POST") {
    const [, eventId] = weRespondMatch;
    const ev = store.worldEvents.find((w) => w.id === eventId);
    if (!ev) return jsonRes({ error: "Event not found" }, 404);
    const body = await readJsonBody(init);
    const action = body.action === "decline" ? "decline" : "accept";
    const confirmFlake = Boolean(body.confirm_flake);

    if (action === "decline") {
      ev.status = "declined";
      updatePersonaState(store, ev.persona_id, { affinityDelta: -2 });
      saveStore(store);
      emitEvent("world:update", { reason: "invite_declined" });
      return jsonRes({ ok: true, status: "declined", event: ev });
    }

    const existingConflict = store.worldEvents.find(
      (w) =>
        w.id !== ev.id &&
        w.event_type === "invite" &&
        w.status === "accepted" &&
        w.scheduled_day === ev.scheduled_day &&
        w.scheduled_slot === ev.scheduled_slot
    );

    if (existingConflict && !confirmFlake) {
      const existingPersona = PERSONA_MAP[existingConflict.persona_id];
      return jsonRes(
        {
          conflict: true,
          message: `You already have plans with ${existingPersona?.display_name || existingConflict.persona_id} (${existingConflict.title}) at this time.`,
          existing_event: existingConflict,
          existing_persona: existingPersona,
          new_event: ev,
        },
        409
      );
    }

    if (existingConflict && confirmFlake) {
      existingConflict.status = "flaked";
      updatePersonaState(store, existingConflict.persona_id, {
        affinityDelta: -Math.abs(existingConflict.penalty_affinity || 10),
        trustDelta: -8,
        newMood: "annoyed",
      });
      const flakedPersona = PERSONA_MAP[existingConflict.persona_id];
      if (flakedPersona) {
        const falloutMsg: StoredDmMessage = {
          id: uid(),
          persona_id: flakedPersona.id,
          sender_type: "persona",
          message_type: "text",
          body: `wait seriously? you just bailed on ${existingConflict.title} last second? cool, good to know.`,
          media_url: null,
          media_metadata: {},
          reaction: null,
          reply_to_message_id: null,
          read_at: null,
          bubble_group_id: null,
          created_at: nowIso(),
        };
        store.messages.push(falloutMsg);
        emitEvent("dm:bubble", { persona_id: flakedPersona.id, message: falloutMsg });
      }
    }

    ev.status = "accepted";
    updatePersonaState(store, ev.persona_id, { affinityDelta: 4, trustDelta: 3 });
    saveStore(store);
    emitEvent("world:update", { reason: "invite_accepted" });
    return jsonRes({ ok: true, status: "accepted", event: ev });
  }

  // 18. POST /api/v1/dev/simulate-time
  if (pathname === "/api/v1/dev/simulate-time" && method === "POST") {
    const body = await readJsonBody(init);
    const mode: "day" | "slot" = body.mode === "slot" ? "slot" : "day";

    if (mode === "day") {
      user.current_day += 1;
      user.energy = user.max_energy;
      user.energy_reset_at = nowIso();
    } else {
      const next = advanceTimeSlot(user.current_day, user.current_slot);
      if (next.day > user.current_day) {
        user.energy = user.max_energy;
        user.energy_reset_at = nowIso();
      }
      user.current_day = next.day;
      user.current_slot = next.slot;
    }

    // Resolve accepted invites whose slot has passed
    let completedInvites = 0;
    for (const ev of store.worldEvents) {
      if (ev.status === "accepted" && ev.scheduled_day <= user.current_day) {
        ev.status = "completed";
        completedInvites += 1;
        updatePersonaState(store, ev.persona_id, { affinityDelta: ev.reward_affinity, trustDelta: 5 });
      }
    }

    // Create 2 fresh campus posts + refresh stories/notes
    const createdPosts: string[] = [];
    for (let i = 0; i < 2; i++) {
      const p = PERSONA_ROWS[(user.current_day * 5 + i * 7) % PERSONA_ROWS.length];
      if (p) {
        const post = createBotPost(store, p, -i * 1000);
        createdPosts.push(post.id);
      }
    }
    ensureCampusStoriesAndNotes(store, 6);

    // Tier-gated World Director: invite or spontaneous ping for personas the user has built affinity with
    const directorEvents: string[] = [];
    const inviteCandidate = INVITE_POOL.find((tpl) => {
      const st = store.states[tpl.personaId];
      const alreadyExists = store.worldEvents.some(
        (we) => we.persona_id === tpl.personaId && we.title === tpl.title && we.status === "pending"
      );
      return st && st.affinity >= tpl.minAffinity && !alreadyExists;
    });

    if (inviteCandidate) {
      const persona = PERSONA_MAP[inviteCandidate.personaId];
      if (persona) {
        const nextSlot = advanceTimeSlot(user.current_day, user.current_slot);
        const evId = uid();
        const dmMsg: StoredDmMessage = {
          id: uid(),
          persona_id: persona.id,
          sender_type: "persona",
          message_type: "event_invite",
          body: inviteCandidate.inviteLine,
          media_url: null,
          media_metadata: {
            world_event_id: evId,
            title: inviteCandidate.title,
            description: inviteCandidate.description,
            scheduled_day: nextSlot.day,
            scheduled_slot: nextSlot.slot,
          },
          reaction: null,
          reply_to_message_id: null,
          read_at: null,
          bubble_group_id: null,
          created_at: nowIso(),
        };
        store.messages.push(dmMsg);
        store.worldEvents.unshift({
          id: evId,
          user_id: user.id,
          persona_id: persona.id,
          event_type: "invite",
          title: inviteCandidate.title,
          description: inviteCandidate.description,
          scheduled_day: nextSlot.day,
          scheduled_slot: nextSlot.slot,
          status: "pending",
          reward_affinity: 10,
          penalty_affinity: 10,
          conflict_group: `${nextSlot.day}:${nextSlot.slot}`,
          dm_message_id: dmMsg.id,
          created_at: nowIso(),
        });
        if (store.states[persona.id]) store.states[persona.id].unread_count += 1;
        directorEvents.push(`invite:${persona.id}`);
        emitEvent("notification:push", {
          title: persona.display_name,
          body: `invited you to ${inviteCandidate.title}`,
          route: `/dms/${persona.id}`,
        });
      }
    } else {
      // Check if any persona with affinity >= 15 wants to send a spontaneous ping
      const warmState = Object.values(store.states).find((s) => s.affinity >= 15);
      if (warmState && PERSONA_MAP[warmState.persona_id]) {
        const p = PERSONA_MAP[warmState.persona_id];
        const ping = mockProactiveDm({
          persona: p,
          user,
          state: {
            affinity: warmState.affinity,
            trust: warmState.trust,
            romantic_tension: warmState.romantic_tension,
            current_mood: warmState.current_mood,
            internal_thought: warmState.internal_thought,
            relationship_stage: warmState.relationship_stage,
          },
          reason: "spontaneous_ping",
          memories: [],
        });
        const line = ping.bubbles[0];
        if (line) {
          const msg: StoredDmMessage = {
            id: uid(),
            persona_id: p.id,
            sender_type: "persona",
            message_type: "text",
            body: line,
            media_url: null,
            media_metadata: {},
            reaction: null,
            reply_to_message_id: null,
            read_at: null,
            bubble_group_id: null,
            created_at: nowIso(),
          };
          store.messages.push(msg);
          warmState.unread_count += 1;
          directorEvents.push(`ping:${p.id}`);
          emitEvent("notification:push", {
            title: p.display_name,
            body: line,
            route: `/dms/${p.id}`,
          });
        }
      }
    }

    saveStore(store);
    emitEvent("world:update", { reason: "simulate_time", mode });

    return jsonRes({
      mode,
      user,
      slot_meta: TIME_SLOT_META[user.current_slot],
      flushed_jobs: 0,
      completed_invites: completedInvites,
      expired_events: 0,
      created_posts: createdPosts.length,
      director_events: directorEvents,
    });
  }

  return jsonRes({ error: `Unknown static API route: ${method} ${pathname}` }, 404);
}
