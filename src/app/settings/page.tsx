"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Flame,
  Mic,
  SlidersHorizontal,
  User,
  Volume2,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useRealtime } from "@/components/RealtimeProvider";

interface SettingsState {
  llm_provider: "gemini" | "openai_compatible";
  effective_mode: "gemini" | "openai_compatible" | "mock";
  image_mode: string;
  tts_mode: string;
  has_gemini_key: boolean;
  has_openai_key: boolean;
  has_fallback_key?: boolean;
  fallback_model?: string;
  has_image_key: boolean;
  has_elevenlabs_key: boolean;
  has_tts_key: boolean;
  gemini_roleplay_model: string;
  gemini_fast_model: string;
  gemini_embedding_model: string;
  llm_base_url: string;
  llm_roleplay_model: string;
  llm_fast_model: string;
  image_provider: "auto" | "gemini" | "openai_compatible" | "pollinations" | "curated";
  image_base_url: string;
  image_model: string;
  tts_provider: "auto" | "elevenlabs" | "gemini" | "openai" | "edge_neural";
  elevenlabs_model: string;
  gemini_tts_model: string;
  tts_base_url: string;
  tts_model: string;
  speed_multiplier: number;
}

interface GossipEventLog {
  id: string;
  origin_persona_id: string;
  summary: string;
  juiciness: number;
  reached_personas: string[];
  created_at: string;
}

type SectionKey =
  | null
  | "energy"
  | "time"
  | "ai"
  | "images"
  | "voices"
  | "media_dev"
  | "gossip";

export default function SettingsPage() {
  const router = useRouter();
  const { me, refreshMe, pushToast } = useRealtime();

  const [openSection, setOpenSection] = useState<SectionKey>("ai");
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [gossipLogs, setGossipLogs] = useState<GossipEventLog[]>([]);

  const [provider, setProvider] = useState<"gemini" | "openai_compatible">("gemini");
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiRoleplay, setGeminiRoleplay] = useState("gemini-3.5-flash");
  const [geminiFast, setGeminiFast] = useState("gemini-flash-lite-latest");
  const [geminiEmbed, setGeminiEmbed] = useState("gemini-embedding-001");
  const [oaiBaseUrl, setOaiBaseUrl] = useState("");
  const [oaiKey, setOaiKey] = useState("");
  const [oaiRoleplay, setOaiRoleplay] = useState("nvidia/nemotron-3.5-bolt-e4b");
  const [oaiFast, setOaiFast] = useState("nvidia/nemotron-3.5-bolt-e4b");

  const [imageProvider, setImageProvider] = useState<
    "auto" | "gemini" | "openai_compatible" | "pollinations" | "curated"
  >("curated");
  const [imageBaseUrl, setImageBaseUrl] = useState("");
  const [imageApiKey, setImageApiKey] = useState("");
  const [imageModel, setImageModel] = useState("gemini-3.1-flash-image");

  const [ttsProvider, setTtsProvider] = useState<
    "auto" | "elevenlabs" | "gemini" | "openai" | "edge_neural"
  >("gemini");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [ttsApiKey, setTtsApiKey] = useState("");
  const [geminiTtsModel, setGeminiTtsModel] = useState("gemini-3.8-flash-tts");
  const [previewPersona, setPreviewPersona] = useState("chloe");
  const [testingVoice, setTestingVoice] = useState(false);

  const [speedMultiplier, setSpeedMultiplier] = useState(1);

  const [boostPersonaId, setBoostPersonaId] = useState("bella");
  const [boostAffinity, setBoostAffinity] = useState(78);
  const [boostRomance, setBoostRomance] = useState(55);

  const [busyTime, setBusyTime] = useState<"slot" | "day" | null>(null);
  const [savingAi, setSavingAi] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [setRes, crewRes] = await Promise.all([
      fetch("/api/v1/dev/settings", { cache: "no-store" }),
      fetch("/api/v1/graph/crew", { cache: "no-store" }),
    ]);
    if (setRes.ok) {
      const d = (await setRes.json()) as SettingsState;
      setSettings(d);
      setProvider(d.llm_provider);
      setGeminiRoleplay(d.gemini_roleplay_model);
      setGeminiFast(d.gemini_fast_model);
      setGeminiEmbed(d.gemini_embedding_model);
      setOaiBaseUrl(d.llm_base_url);
      setOaiRoleplay(d.llm_roleplay_model);
      setOaiFast(d.llm_fast_model);
      setImageProvider(d.image_provider);
      setImageBaseUrl(d.image_base_url);
      setImageModel(d.image_model);
      setTtsProvider(d.tts_provider);
      setGeminiTtsModel(d.gemini_tts_model);
      setSpeedMultiplier(d.speed_multiplier);
    }
    if (crewRes.ok) {
      const c = await crewRes.json();
      setGossipLogs(c.gossip_events || []);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const toggle = (key: SectionKey) => setOpenSection((prev) => (prev === key ? null : key));

  const handleSimulateTime = async (mode: "slot" | "day") => {
    setBusyTime(mode);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/v1/dev/simulate-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (res.ok) {
        const parts: string[] = [
          `Day ${data.user.current_day} · ${data.slot_meta?.label || data.user.current_slot}`,
        ];
        if (data.created_posts?.length) parts.push(`${data.created_posts.length} posts`);
        if (data.completed_invites?.length)
          parts.push(`Completed: ${data.completed_invites.join(", ")}`);
        if (data.director_events?.length) {
          parts.push(`${data.director_events.length} world events`);
        }
        setStatusMsg(parts.join(" · "));
        await refreshMe();
        await loadAll();
      }
    } finally {
      setBusyTime(null);
    }
  };

  const handleSaveAi = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAi(true);
    try {
      const payload: Record<string, unknown> = {
        llm_provider: provider,
        gemini_roleplay_model: geminiRoleplay,
        gemini_fast_model: geminiFast,
        gemini_embedding_model: geminiEmbed,
        llm_base_url: oaiBaseUrl,
        llm_roleplay_model: oaiRoleplay,
        llm_fast_model: oaiFast,
        image_provider: imageProvider,
        image_base_url: imageBaseUrl,
        image_model: imageModel,
        tts_provider: ttsProvider,
        gemini_tts_model: geminiTtsModel,
        speed_multiplier: speedMultiplier,
      };
      if (geminiKey.trim()) payload.gemini_api_key = geminiKey.trim();
      if (oaiKey.trim()) payload.llm_api_key = oaiKey.trim();
      if (imageApiKey.trim()) payload.image_api_key = imageApiKey.trim();
      if (elevenLabsKey.trim()) payload.elevenlabs_api_key = elevenLabsKey.trim();
      if (ttsApiKey.trim()) payload.tts_api_key = ttsApiKey.trim();

      const res = await fetch("/api/v1/dev/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = await res.json();
        setGeminiKey("");
        setOaiKey("");
        setImageApiKey("");
        setElevenLabsKey("");
        setTtsApiKey("");
        await refreshMe();
        await loadAll();
        pushToast({
          title: "AI Engine Updated",
          body: `LLM: ${updated.effective_mode} · Photos: ${updated.image_mode} · Voice: ${updated.tts_mode}`,
        });
      }
    } finally {
      setSavingAi(false);
    }
  };

  const testRealVoice = async () => {
    setTestingVoice(true);
    try {
      const res = await fetch("/api/v1/dev/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_voice_persona_id: previewPersona }),
      });
      const data = await res.json();
      if (res.ok && data.voice_sample?.audioUrl) {
        const audio = new Audio(data.voice_sample.audioUrl);
        await audio.play();
        pushToast({
          title: `Playing @${previewPersona}`,
          body: `${data.voice_sample.providerUsed} (${data.voice_sample.voiceName})`,
        });
      }
    } finally {
      setTestingVoice(false);
    }
  };

  const togglePlan = async () => {
    const nextPlan = me?.user?.plan_tier === "pro" ? "free" : "pro";
    await fetch("/api/v1/dev/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_tier: nextPlan }),
    });
    await refreshMe();
  };

  const setPacing = async (next: number) => {
    setSpeedMultiplier(next);
    await fetch("/api/v1/dev/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speed_multiplier: next }),
    });
    await refreshMe();
  };

  const handleBoostPersona = async () => {
    const res = await fetch("/api/v1/dev/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        boost_persona: {
          persona_id: boostPersonaId,
          affinity: boostAffinity,
          romantic_tension: boostRomance,
        },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      pushToast({
        title: `Updated @${boostPersonaId}`,
        body: `Unlocked: ${data.boosted_tier?.label}`,
        route: `/dms/${boostPersonaId}`,
      });
    }
  };

  const handleResetWorld = async () => {
    await fetch("/api/v1/dev/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reset_world: true }),
    });
    await refreshMe();
    router.push("/");
  };

  const user = me?.user;

  return (
    <AppShell>
      <header className="sticky top-0 z-20 flex h-[50px] items-center justify-between border-b border-white/[0.08] bg-[#0D0E12]/95 px-3 backdrop-blur-md">
        <Link href="/profile" className="flex items-center gap-0.5 text-[15px] text-[#5E5CE6]">
          <ChevronLeft className="h-5 w-5" />
          <span>Profile</span>
        </Link>
        <h1 className="text-[16px] font-semibold text-white">Settings</h1>
        <span className="w-16" />
      </header>

      <div className="space-y-5 px-4 py-5">
        {/* Live AI Status Summary */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#18191E] p-4">
          <div className="text-[12px] font-medium uppercase tracking-wide text-[#8E8E93]">
            Vela Live AI Readiness
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-[#0D0E12] px-2 py-2">
              <div className="text-[11px] text-[#8E8E93]">Chat LLM</div>
              <div
                className={`mt-0.5 truncate text-[12px] font-semibold ${
                  settings?.effective_mode && settings.effective_mode !== "mock"
                    ? "text-[#30D158]"
                    : "text-white"
                }`}
              >
                {settings?.effective_mode === "mock"
                  ? "Needs Key"
                  : settings?.effective_mode === "gemini" && settings?.has_fallback_key
                    ? "Gemini + NIM"
                    : settings?.effective_mode || "Loading"}
              </div>
            </div>
            <div className="rounded-xl bg-[#0D0E12] px-2 py-2">
              <div className="text-[11px] text-[#8E8E93]">Photos</div>
              <div className="mt-0.5 truncate text-[12px] font-semibold text-white">
                {settings?.image_mode?.startsWith("curated")
                  ? "Real Bank"
                  : settings?.image_mode?.startsWith("pollinations")
                    ? "FLUX Free"
                    : "Live AI"}
              </div>
            </div>
            <div className="rounded-xl bg-[#0D0E12] px-2 py-2">
              <div className="text-[11px] text-[#8E8E93]">22 Voices</div>
              <div className="mt-0.5 truncate text-[12px] font-semibold text-[#30D158]">
                {settings?.tts_mode?.includes("gemini")
                  ? "Gemini + Edge"
                  : settings?.tts_mode?.includes("edge")
                    ? "Edge Neural"
                    : "Live Neural"}
              </div>
            </div>
          </div>
        </div>

        {/* Group 1: AI Engines (LLM + Photos + Real Voices) */}
        <div>
          <div className="mb-1.5 px-3 text-[12px] font-medium uppercase tracking-wide text-[#8E8E93]">
            AI Engines &amp; API Keys
          </div>
          <div className="divide-y divide-white/[0.08] overflow-hidden rounded-2xl bg-[#18191E]">
            {/* Chat & Vision LLM */}
            <div>
              <button
                type="button"
                onClick={() => toggle("ai")}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E5CE6] text-white">
                    <Cpu className="h-4 w-4" />
                  </span>
                  <span className="text-[15px] text-white">Chat &amp; Vision LLM</span>
                </div>
                <div className="flex items-center gap-1.5 text-[14px] capitalize text-[#8E8E93]">
                  <span>{settings?.effective_mode || "mock"}</span>
                  <ChevronRight
                    className={`h-4 w-4 transition ${openSection === "ai" ? "rotate-90" : ""}`}
                  />
                </div>
              </button>

              {openSection === "ai" && (
                <form
                  onSubmit={handleSaveAi}
                  className="space-y-3 border-t border-white/[0.08] bg-[#131419] px-4 py-3.5"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setProvider("gemini")}
                      className={`rounded-full py-2 text-[13px] font-semibold ${
                        provider === "gemini"
                          ? "bg-[#5E5CE6] text-white"
                          : "bg-[#262930] text-[#8E8E93]"
                      }`}
                    >
                      Google Gemini
                    </button>
                    <button
                      type="button"
                      onClick={() => setProvider("openai_compatible")}
                      className={`rounded-full py-2 text-[13px] font-semibold ${
                        provider === "openai_compatible"
                          ? "bg-[#5E5CE6] text-white"
                          : "bg-[#262930] text-[#8E8E93]"
                      }`}
                    >
                      OpenAI / Grok / NIM
                    </button>
                  </div>

                  {provider === "gemini" ? (
                    <div className="space-y-2.5">
                      <p className="text-[12px] text-[#8E8E93]">
                        One GEMINI_API_KEY powers Live Chat, Vision, Embeddings, Imagen Photos, and
                        22-Voice Gemini TTS.
                      </p>
                      <input
                        type="password"
                        value={geminiKey}
                        onChange={(e) => setGeminiKey(e.target.value)}
                        placeholder={
                          settings?.has_gemini_key
                            ? "GEMINI_API_KEY configured (paste to replace)"
                            : "Paste GEMINI_API_KEY"
                        }
                        className="w-full rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[13px] text-white placeholder-[#8E8E93]"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={geminiRoleplay}
                          onChange={(e) => setGeminiRoleplay(e.target.value)}
                          aria-label="Roleplay model"
                          className="rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[12px] text-white"
                        />
                        <input
                          type="text"
                          value={geminiFast}
                          onChange={(e) => setGeminiFast(e.target.value)}
                          aria-label="Fast model"
                          className="rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[12px] text-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <input
                        type="url"
                        value={oaiBaseUrl}
                        onChange={(e) => setOaiBaseUrl(e.target.value)}
                        placeholder="https://api.x.ai/v1"
                        className="w-full rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[13px] text-white placeholder-[#8E8E93]"
                      />
                      <input
                        type="password"
                        value={oaiKey}
                        onChange={(e) => setOaiKey(e.target.value)}
                        placeholder="Paste LLM_API_KEY"
                        className="w-full rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[13px] text-white placeholder-[#8E8E93]"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={oaiRoleplay}
                          onChange={(e) => setOaiRoleplay(e.target.value)}
                          aria-label="OpenAI roleplay model"
                          className="rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[12px] text-white"
                        />
                        <input
                          type="text"
                          value={oaiFast}
                          onChange={(e) => setOaiFast(e.target.value)}
                          aria-label="OpenAI fast model"
                          className="rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[12px] text-white"
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={savingAi}
                    className="w-full rounded-full bg-[#5E5CE6] py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
                  >
                    {savingAi ? "Saving..." : "Save AI Keys"}
                  </button>
                </form>
              )}
            </div>

            {/* Photorealistic Image Engine */}
            <div>
              <button
                type="button"
                onClick={() => toggle("images")}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E5CE6] text-white">
                    <Camera className="h-4 w-4" />
                  </span>
                  <span className="text-[15px] text-white">Photo Engine</span>
                </div>
                <div className="flex items-center gap-1.5 text-[13px] text-[#8E8E93]">
                  <span className="whitespace-nowrap">
                    {settings?.image_mode?.startsWith("curated")
                      ? "Real Bank"
                      : settings?.image_mode || "Real Bank"}
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 transition ${openSection === "images" ? "rotate-90" : ""}`}
                  />
                </div>
              </button>

              {openSection === "images" && (
                <form
                  onSubmit={handleSaveAi}
                  className="space-y-2.5 border-t border-white/[0.08] bg-[#131419] px-4 py-3.5"
                >
                  <select
                    aria-label="Image provider"
                    value={imageProvider}
                    onChange={(e) =>
                      setImageProvider(
                        e.target.value as
                          | "auto"
                          | "gemini"
                          | "openai_compatible"
                          | "pollinations"
                          | "curated"
                      )
                    }
                    className="w-full rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[13px] text-white"
                  >
                    <option value="curated">Curated Real Campus Photos ($0 · Watermark-free)</option>
                    <option value="pollinations">Pollinations FLUX ($0 · 1 AI photo / 45s)</option>
                    <option value="gemini">Gemini Image (Requires billed GEMINI_API_KEY)</option>
                    <option value="openai_compatible">OpenAI / Grok / Flux Image API</option>
                  </select>
                  <input
                    type="text"
                    value={imageModel}
                    onChange={(e) => setImageModel(e.target.value)}
                    placeholder="imagen-3.0-generate-002 or gemini-2.5-flash-image"
                    className="w-full rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[12px] text-white"
                  />
                  {imageProvider === "openai_compatible" && (
                    <>
                      <input
                        type="url"
                        value={imageBaseUrl}
                        onChange={(e) => setImageBaseUrl(e.target.value)}
                        placeholder="https://api.openai.com/v1 or https://api.x.ai/v1"
                        className="w-full rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[12px] text-white"
                      />
                      <input
                        type="password"
                        value={imageApiKey}
                        onChange={(e) => setImageApiKey(e.target.value)}
                        placeholder="Paste IMAGE_API_KEY"
                        className="w-full rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[12px] text-white"
                      />
                    </>
                  )}
                  <button
                    type="submit"
                    disabled={savingAi}
                    className="w-full rounded-full bg-[#5E5CE6] py-2 text-[13px] font-semibold text-white"
                  >
                    Save Photo Engine
                  </button>
                </form>
              )}
            </div>

            {/* Real 22-Voice Neural TTS */}
            <div>
              <button
                type="button"
                onClick={() => toggle("voices")}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E5CE6] text-white">
                    <Mic className="h-4 w-4" />
                  </span>
                  <span className="text-[15px] text-white">Voice Engine (TTS)</span>
                </div>
                <div className="flex items-center gap-1.5 text-[13px] text-[#8E8E93]">
                  <span className="whitespace-nowrap">
                    {settings?.tts_mode?.includes("edge")
                      ? "Edge Neural"
                      : settings?.tts_mode || "Edge Neural"}
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 transition ${openSection === "voices" ? "rotate-90" : ""}`}
                  />
                </div>
              </button>

              {openSection === "voices" && (
                <form
                  onSubmit={handleSaveAi}
                  className="space-y-2.5 border-t border-white/[0.08] bg-[#131419] px-4 py-3.5"
                >
                  <select
                    aria-label="Voice provider"
                    value={ttsProvider}
                    onChange={(e) =>
                      setTtsProvider(
                        e.target.value as
                          | "auto"
                          | "elevenlabs"
                          | "gemini"
                          | "openai"
                          | "edge_neural"
                      )
                    }
                    className="w-full rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[13px] text-white"
                  >
                    <option value="edge_neural">Microsoft Edge Neural (22 Free Human Voices)</option>
                    <option value="gemini">Gemini Native TTS (22 Voices · GEMINI_API_KEY)</option>
                    <option value="elevenlabs">ElevenLabs Neural (22 Voices · ELEVENLABS_API_KEY)</option>
                    <option value="openai">OpenAI gpt-4o-mini-tts (TTS_API_KEY)</option>
                  </select>

                  {ttsProvider === "elevenlabs" && (
                    <input
                      type="password"
                      value={elevenLabsKey}
                      onChange={(e) => setElevenLabsKey(e.target.value)}
                      placeholder="Paste ELEVENLABS_API_KEY"
                      className="w-full rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[12px] text-white"
                    />
                  )}
                  {ttsProvider === "openai" && (
                    <input
                      type="password"
                      value={ttsApiKey}
                      onChange={(e) => setTtsApiKey(e.target.value)}
                      placeholder="Paste TTS_API_KEY (OpenAI)"
                      className="w-full rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[12px] text-white"
                    />
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <select
                      aria-label="Preview persona voice"
                      value={previewPersona}
                      onChange={(e) => setPreviewPersona(e.target.value)}
                      className="flex-1 rounded-xl border border-white/[0.08] bg-[#18191E] px-3 py-2 text-[13px] text-white"
                    >
                      {["chloe", "bella", "theo", "maya", "leo", "sofia", "cole", "lucas", "gabe", "nina"].map(
                        (pid) => (
                          <option key={pid} value={pid}>
                            Audition @{pid}
                          </option>
                        )
                      )}
                    </select>
                    <button
                      type="button"
                      disabled={testingVoice}
                      onClick={() => void testRealVoice()}
                      className="flex items-center gap-1.5 rounded-full bg-[#262930] px-4 py-2 text-[13px] font-semibold text-white"
                    >
                      <Volume2 className="h-4 w-4" />
                      {testingVoice ? "Loading..." : "Play"}
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={savingAi}
                    className="w-full rounded-full bg-[#5E5CE6] py-2 text-[13px] font-semibold text-white"
                  >
                    Save Voice Engine
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

        {/* Group 2: Time Controls & Simulation */}
        <div>
          <div className="mb-1.5 px-3 text-[12px] font-medium uppercase tracking-wide text-[#8E8E93]">
            Campus Time &amp; World Director
          </div>
          <div className="divide-y divide-white/[0.08] overflow-hidden rounded-2xl bg-[#18191E]">
            <div>
              <button
                type="button"
                onClick={() => toggle("time")}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E5CE6] text-white">
                    <Clock className="h-4 w-4" />
                  </span>
                  <span className="text-[15px] text-white">Time Controls</span>
                </div>
                <div className="flex items-center gap-1.5 text-[14px] text-[#8E8E93]">
                  <span>
                    Day {user?.current_day ?? 1} · {me?.slot_meta?.label || "Afternoon"}
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 transition ${openSection === "time" ? "rotate-90" : ""}`}
                  />
                </div>
              </button>

              {openSection === "time" && (
                <div className="space-y-3 border-t border-white/[0.08] bg-[#131419] px-4 py-3.5">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busyTime !== null}
                      onClick={() => void handleSimulateTime("slot")}
                      className="rounded-full bg-[#262930] py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
                    >
                      {busyTime === "slot" ? "Advancing..." : "Next +6h Slot"}
                    </button>
                    <button
                      type="button"
                      disabled={busyTime !== null}
                      onClick={() => void handleSimulateTime("day")}
                      className="rounded-full bg-[#5E5CE6] py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
                    >
                      {busyTime === "day" ? "Simulating..." : "Simulate +24h"}
                    </button>
                  </div>

                  {statusMsg && <p className="text-[12px] text-[#8E8E93]">{statusMsg}</p>}

                  <div className="flex items-center justify-between border-t border-white/[0.08] pt-3">
                    <span className="text-[13px] text-white">Reply Pacing</span>
                    <div className="flex rounded-full bg-[#262930] p-0.5 text-[12px] font-medium">
                      {[
                        { val: 1, label: "1x Real" },
                        { val: 5, label: "5x" },
                        { val: 15, label: "15x Fast" },
                      ].map((opt) => (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => void setPacing(opt.val)}
                          className={`rounded-full px-2.5 py-1 ${
                            speedMultiplier === opt.val
                              ? "bg-[#5E5CE6] text-white"
                              : "text-[#8E8E93]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => toggle("energy")}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E5CE6] text-white">
                    <Zap className="h-4 w-4" />
                  </span>
                  <span className="text-[15px] text-white">Energy &amp; Plan</span>
                </div>
                <div className="flex items-center gap-1.5 text-[14px] text-[#8E8E93]">
                  <span>
                    {user ? `${user.energy}/${user.max_energy}` : "20/20"} ·{" "}
                    {user?.plan_tier === "pro" ? "Pro" : "Free"}
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 transition ${openSection === "energy" ? "rotate-90" : ""}`}
                  />
                </div>
              </button>

              {openSection === "energy" && user && (
                <div className="space-y-3 border-t border-white/[0.08] bg-[#131419] px-4 py-3.5">
                  <div className="flex items-center justify-between text-[13px] text-[#8E8E93]">
                    <span>Daily interaction allowance</span>
                    <button
                      type="button"
                      onClick={() => void togglePlan()}
                      className="rounded-full bg-[#262930] px-3.5 py-1.5 text-[13px] font-semibold text-white"
                    >
                      Switch to {user.plan_tier === "pro" ? "Free" : "Pro"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <Link
              href="/activity"
              className="flex items-center justify-between px-4 py-3 transition hover:bg-white/[0.03]"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E5CE6] text-white">
                  <Calendar className="h-4 w-4" />
                </span>
                <span className="text-[15px] text-white">Campus Schedule</span>
              </div>
              <div className="flex items-center gap-1.5 text-[14px] text-[#8E8E93]">
                <span>{me?.active_world_events_count ?? 0} active</span>
                <ChevronRight className="h-4 w-4" />
              </div>
            </Link>

            <Link
              href="/profile"
              className="flex items-center justify-between px-4 py-3 transition hover:bg-white/[0.03]"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E5CE6] text-white">
                  <User className="h-4 w-4" />
                </span>
                <span className="text-[15px] text-white">Profile</span>
              </div>
              <div className="flex items-center gap-1.5 text-[14px] text-[#8E8E93]">
                <span>{user?.handle || "@you"}</span>
                <ChevronRight className="h-4 w-4" />
              </div>
            </Link>
          </div>
        </div>

        {/* Group 3: Diagnostics */}
        <div>
          <div className="mb-1.5 px-3 text-[12px] font-medium uppercase tracking-wide text-[#8E8E93]">
            Diagnostics
          </div>
          <div className="divide-y divide-white/[0.08] overflow-hidden rounded-2xl bg-[#18191E]">
            <div>
              <button
                type="button"
                onClick={() => toggle("media_dev")}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E5CE6] text-white">
                    <SlidersHorizontal className="h-4 w-4" />
                  </span>
                  <span className="text-[15px] text-white">Proximity Tier Tester</span>
                </div>
                <ChevronRight
                  className={`h-4 w-4 text-[#8E8E93] transition ${openSection === "media_dev" ? "rotate-90" : ""}`}
                />
              </button>

              {openSection === "media_dev" && (
                <div className="space-y-3 border-t border-white/[0.08] bg-[#131419] px-4 py-3.5">
                  <p className="text-[12px] text-[#8E8E93]">
                    Override affinity &amp; tension for QA testing: Text (&lt;25), Photos (25+),
                    Voice Notes (50+), Videos / View-Once (75+ or tension 50+).
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      aria-label="Persona"
                      value={boostPersonaId}
                      onChange={(e) => setBoostPersonaId(e.target.value)}
                      className="rounded-xl border border-white/[0.08] bg-[#18191E] px-2.5 py-2 text-[13px] text-white"
                    >
                      {[
                        "bella",
                        "chloe",
                        "theo",
                        "maya",
                        "sofia",
                        "cole",
                        "jade",
                        "gabe",
                        "lucas",
                        "mel",
                        "parker",
                        "leo",
                      ].map((id) => (
                        <option key={id} value={id}>
                          @{id}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={boostAffinity}
                      onChange={(e) => setBoostAffinity(Number(e.target.value))}
                      aria-label="Affinity"
                      className="rounded-xl border border-white/[0.08] bg-[#18191E] px-2.5 py-2 text-[13px] text-white"
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={boostRomance}
                      onChange={(e) => setBoostRomance(Number(e.target.value))}
                      aria-label="Tension"
                      className="rounded-xl border border-white/[0.08] bg-[#18191E] px-2.5 py-2 text-[13px] text-white"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleBoostPersona()}
                    className="w-full rounded-full bg-[#262930] py-2 text-[13px] font-semibold text-white"
                  >
                    Apply Tier Override
                  </button>
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => toggle("gossip")}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E5CE6] text-white">
                    <Flame className="h-4 w-4" />
                  </span>
                  <span className="text-[15px] text-white">Gossip Logs</span>
                </div>
                <div className="flex items-center gap-1.5 text-[14px] text-[#8E8E93]">
                  <span>{gossipLogs.length}</span>
                  <ChevronRight
                    className={`h-4 w-4 transition ${openSection === "gossip" ? "rotate-90" : ""}`}
                  />
                </div>
              </button>

              {openSection === "gossip" && (
                <div className="space-y-2.5 border-t border-white/[0.08] bg-[#131419] px-4 py-3">
                  {gossipLogs.length === 0 ? (
                    <p className="text-[13px] text-[#8E8E93]">No campus leaks recorded yet.</p>
                  ) : (
                    gossipLogs.map((g) => (
                      <div
                        key={g.id}
                        className="border-b border-white/[0.06] pb-2 last:border-0 last:pb-0"
                      >
                        <div className="text-[13px] text-white">{g.summary}</div>
                        <div className="mt-0.5 text-[12px] text-[#8E8E93]">
                          From @{g.origin_persona_id} →{" "}
                          {g.reached_personas.length > 0
                            ? g.reached_personas.map((id) => `@${id}`).join(", ")
                            : "contained"}{" "}
                          · {g.juiciness}/10
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Reset World */}
        <div className="overflow-hidden rounded-2xl bg-[#18191E]">
          <button
            type="button"
            onClick={() => void handleResetWorld()}
            className="w-full py-3.5 text-center text-[15px] font-medium text-[#FF453A] transition hover:bg-white/[0.03]"
          >
            Reset World (Start Fresh at 0)
          </button>
        </div>

        <p className="text-center text-[12px] text-[#8E8E93]">
          Vela · DB: {me?.runtime?.db_driver || "pglite"}
        </p>
      </div>
    </AppShell>
  );
}
