export type LlmProviderType = "gemini" | "openai_compatible";
export type ImageProviderType = "auto" | "gemini" | "openai_compatible" | "pollinations" | "curated";
export type TtsProviderType = "auto" | "elevenlabs" | "gemini" | "openai" | "edge_neural";

export interface RuntimeConfig {
  llmProvider: LlmProviderType;
  geminiApiKey: string;
  geminiRoleplayModel: string;
  geminiRoleplayFallbackModel: string;
  geminiFastModel: string;
  geminiFastFallbackModel: string;
  geminiEmbeddingModel: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmRoleplayModel: string;
  llmFastModel: string;
  llmEmbeddingModel: string;

  // Automatic secondary live failover (e.g. Free NVIDIA NIM when Gemini hits 429/503)
  fallbackBaseUrl: string;
  fallbackApiKey: string;
  fallbackModel: string;

  // Photorealistic Image Generation Engine
  imageProvider: ImageProviderType;
  imageBaseUrl: string;
  imageApiKey: string;
  imageModel: string;

  // Real Neural TTS Voice Engine (22 unique human voices)
  ttsProvider: TtsProviderType;
  elevenLabsApiKey: string;
  elevenLabsModel: string;
  geminiTtsModel: string;
  ttsBaseUrl: string;
  ttsApiKey: string;
  ttsModel: string;

  // Optional custom webhook overrides (legacy compatibility)
  mediaTtsEndpoint: string;
  mediaImageEndpoint: string;
  mediaVideoEndpoint: string;

  // Pacing: 1 = authentic real-world campus pace, 5 = brisk testing pace
  speedMultiplier: number;
}

const globalForConfig = globalThis as unknown as {
  __velaRuntimeConfig?: RuntimeConfig;
};

function loadInitialConfig(): RuntimeConfig {
  const providerRaw = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  const llmProvider: LlmProviderType =
    providerRaw === "openai_compatible" ? "openai_compatible" : "gemini";

  const imgRaw = (process.env.IMAGE_PROVIDER || "auto").toLowerCase();
  const imageProvider: ImageProviderType =
    imgRaw === "gemini" ||
    imgRaw === "openai_compatible" ||
    imgRaw === "pollinations" ||
    imgRaw === "curated"
      ? imgRaw
      : process.env.IMAGE_API_KEY && process.env.IMAGE_BASE_URL
        ? "openai_compatible"
        : "curated";

  const ttsRaw = (process.env.TTS_PROVIDER || "auto").toLowerCase();
  const ttsProvider: TtsProviderType =
    ttsRaw === "elevenlabs" ||
    ttsRaw === "gemini" ||
    ttsRaw === "openai" ||
    ttsRaw === "edge_neural"
      ? ttsRaw
      : process.env.ELEVENLABS_API_KEY
        ? "elevenlabs"
        : process.env.TTS_API_KEY
          ? "openai"
          : process.env.GEMINI_API_KEY
            ? "gemini"
            : "edge_neural";

  const speedRaw = Number(process.env.SIMULATION_SPEED_MULTIPLIER || "1");
  const speedMultiplier = Number.isFinite(speedRaw) && speedRaw >= 1 ? speedRaw : 1;

  return {
    llmProvider,
    geminiApiKey: (process.env.GEMINI_API_KEY || "").trim(),
    geminiRoleplayModel: (process.env.GEMINI_ROLEPLAY_MODEL || "gemini-3.5-flash").trim(),
    geminiRoleplayFallbackModel: (
      process.env.GEMINI_ROLEPLAY_FALLBACK_MODEL || "gemini-3-flash-preview"
    ).trim(),
    geminiFastModel: (process.env.GEMINI_FAST_MODEL || "gemini-flash-lite-latest").trim(),
    geminiFastFallbackModel: (
      process.env.GEMINI_FAST_FALLBACK_MODEL || "gemini-3.5-flash-lite"
    ).trim(),
    geminiEmbeddingModel: (process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001").trim(),
    llmBaseUrl: (process.env.LLM_BASE_URL || "").trim().replace(/\/+$/, ""),
    llmApiKey: (process.env.LLM_API_KEY || "").trim(),
    llmRoleplayModel: (process.env.LLM_ROLEPLAY_MODEL || "nvidia/nemotron-3.5-bolt-e4b").trim(),
    llmFastModel: (process.env.LLM_FAST_MODEL || "nvidia/nemotron-3.5-bolt-e4b").trim(),
    llmEmbeddingModel: (process.env.LLM_EMBEDDING_MODEL || "").trim(),

    fallbackBaseUrl: (process.env.FALLBACK_LLM_BASE_URL || "").trim().replace(/\/+$/, ""),
    fallbackApiKey: (process.env.FALLBACK_LLM_API_KEY || "").trim(),
    fallbackModel: (process.env.FALLBACK_LLM_MODEL || "nvidia/nemotron-3.5-bolt-e4b").trim(),

    imageProvider,
    imageBaseUrl: (process.env.IMAGE_BASE_URL || "").trim().replace(/\/+$/, ""),
    imageApiKey: (process.env.IMAGE_API_KEY || "").trim(),
    imageModel: (process.env.IMAGE_MODEL || "gemini-3.1-flash-image").trim(),

    ttsProvider,
    elevenLabsApiKey: (process.env.ELEVENLABS_API_KEY || "").trim(),
    elevenLabsModel: (process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5").trim(),
    geminiTtsModel: (process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts").trim(),
    ttsBaseUrl: (process.env.TTS_BASE_URL || "https://api.openai.com/v1").trim().replace(/\/+$/, ""),
    ttsApiKey: (process.env.TTS_API_KEY || "").trim(),
    ttsModel: (process.env.TTS_MODEL || "gpt-4o-mini-tts").trim(),

    mediaTtsEndpoint: (process.env.MEDIA_TTS_ENDPOINT || "").trim(),
    mediaImageEndpoint: (process.env.MEDIA_IMAGE_ENDPOINT || "").trim(),
    mediaVideoEndpoint: (process.env.MEDIA_VIDEO_ENDPOINT || "").trim(),

    speedMultiplier,
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  if (!globalForConfig.__velaRuntimeConfig) {
    globalForConfig.__velaRuntimeConfig = loadInitialConfig();
  }
  return globalForConfig.__velaRuntimeConfig;
}

export function updateRuntimeConfig(patch: Partial<RuntimeConfig>): RuntimeConfig {
  const current = getRuntimeConfig();
  // Strip undefined properties so partial settings updates NEVER overwrite existing fields!
  const definedPatch: Partial<RuntimeConfig> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      (definedPatch as Record<string, unknown>)[k] = v;
    }
  }
  const next: RuntimeConfig = {
    ...current,
    ...definedPatch,
    llmBaseUrl:
      patch.llmBaseUrl !== undefined
        ? patch.llmBaseUrl.trim().replace(/\/+$/, "")
        : current.llmBaseUrl,
    fallbackBaseUrl:
      patch.fallbackBaseUrl !== undefined
        ? patch.fallbackBaseUrl.trim().replace(/\/+$/, "")
        : current.fallbackBaseUrl,
    imageBaseUrl:
      patch.imageBaseUrl !== undefined
        ? patch.imageBaseUrl.trim().replace(/\/+$/, "")
        : current.imageBaseUrl,
    ttsBaseUrl:
      patch.ttsBaseUrl !== undefined
        ? patch.ttsBaseUrl.trim().replace(/\/+$/, "")
        : current.ttsBaseUrl,
    geminiApiKey:
      patch.geminiApiKey !== undefined ? patch.geminiApiKey.trim() : current.geminiApiKey,
    llmApiKey: patch.llmApiKey !== undefined ? patch.llmApiKey.trim() : current.llmApiKey,
    fallbackApiKey:
      patch.fallbackApiKey !== undefined ? patch.fallbackApiKey.trim() : current.fallbackApiKey,
    imageApiKey: patch.imageApiKey !== undefined ? patch.imageApiKey.trim() : current.imageApiKey,
    elevenLabsApiKey:
      patch.elevenLabsApiKey !== undefined
        ? patch.elevenLabsApiKey.trim()
        : current.elevenLabsApiKey,
    ttsApiKey: patch.ttsApiKey !== undefined ? patch.ttsApiKey.trim() : current.ttsApiKey,
    speedMultiplier:
      patch.speedMultiplier !== undefined
        ? Math.max(1, Math.min(30, Number(patch.speedMultiplier) || 1))
        : current.speedMultiplier,
  };

  if (patch.elevenLabsApiKey) {
    next.ttsProvider = "elevenlabs";
  } else if (patch.geminiApiKey && next.ttsProvider === "edge_neural" && !patch.ttsProvider) {
    next.ttsProvider = "gemini";
  }

  globalForConfig.__velaRuntimeConfig = next;
  return next;
}

export function getEffectiveLlmMode(): {
  mode: "gemini" | "openai_compatible" | "mock";
  provider: LlmProviderType;
  roleplayModel: string;
  fastModel: string;
  embeddingModel: string;
  hasKey: boolean;
  hasFallbackKey: boolean;
  fallbackModel: string;
  imageMode: string;
  ttsMode: string;
} {
  const cfg = getRuntimeConfig();
  const hasFallbackKey = Boolean(cfg.fallbackApiKey && cfg.fallbackBaseUrl);
  const imageMode =
    cfg.imageProvider === "gemini" && cfg.geminiApiKey
      ? `gemini (${cfg.imageModel})`
      : cfg.imageProvider === "openai_compatible" && cfg.imageApiKey && cfg.imageBaseUrl
        ? `openai (${cfg.imageModel})`
        : cfg.imageProvider === "pollinations"
          ? "pollinations-flux (free)"
          : "curated-real-photos";

  const ttsMode =
    cfg.ttsProvider === "elevenlabs" && cfg.elevenLabsApiKey
      ? "elevenlabs-neural"
      : cfg.ttsProvider === "openai" && cfg.ttsApiKey
        ? `openai (${cfg.ttsModel})`
        : cfg.ttsProvider === "gemini" && cfg.geminiApiKey
          ? `gemini (${cfg.geminiTtsModel}) + edge`
          : "edge-neural-22voices";

  if (cfg.llmProvider === "openai_compatible") {
    const hasKey = Boolean(cfg.llmApiKey && cfg.llmBaseUrl);
    return {
      mode: hasKey ? "openai_compatible" : hasFallbackKey ? "openai_compatible" : "mock",
      provider: "openai_compatible",
      roleplayModel: cfg.llmRoleplayModel,
      fastModel: cfg.llmFastModel,
      embeddingModel: cfg.geminiApiKey
        ? cfg.geminiEmbeddingModel
        : cfg.llmEmbeddingModel || "local-768d",
      hasKey: hasKey || hasFallbackKey,
      hasFallbackKey,
      fallbackModel: cfg.fallbackModel,
      imageMode,
      ttsMode,
    };
  }
  const hasKey = Boolean(cfg.geminiApiKey);
  return {
    mode: hasKey ? "gemini" : hasFallbackKey ? "openai_compatible" : "mock",
    provider: "gemini",
    roleplayModel: cfg.geminiRoleplayModel,
    fastModel: cfg.geminiFastModel,
    embeddingModel: cfg.geminiEmbeddingModel,
    hasKey: hasKey || hasFallbackKey,
    hasFallbackKey,
    fallbackModel: cfg.fallbackModel,
    imageMode,
    ttsMode,
  };
}

export function scaleDelayMs(literalMs: number, minMs = 1500): number {
  const { speedMultiplier } = getRuntimeConfig();
  if (speedMultiplier <= 1) return Math.max(minMs, literalMs);
  return Math.max(minMs, Math.round(literalMs / speedMultiplier));
}
