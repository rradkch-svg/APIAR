import { NextResponse } from "next/server";
import { z } from "zod";
import { dbQuery, dbQueryOne } from "@/lib/db/client";
import { getActiveUser, SESSION_COOKIE_NAME } from "@/lib/db/session";
import {
  getEffectiveLlmMode,
  getRuntimeConfig,
  updateRuntimeConfig,
} from "@/lib/config/runtime";
import { computeRelationshipStage, type PersonaRow } from "@/lib/personas/metadata";
import { getMediaUnlockTier } from "@/lib/media/tiers";
import { synthesizePersonaVoiceNote } from "@/lib/media/tts-engine";

const settingsPatchSchema = z.object({
  llm_provider: z.enum(["gemini", "openai_compatible"]).optional(),
  gemini_api_key: z.string().optional(),
  gemini_roleplay_model: z.string().optional(),
  gemini_fast_model: z.string().optional(),
  gemini_embedding_model: z.string().optional(),
  llm_base_url: z.string().optional(),
  llm_api_key: z.string().optional(),
  llm_roleplay_model: z.string().optional(),
  llm_fast_model: z.string().optional(),

  image_provider: z
    .enum(["auto", "gemini", "openai_compatible", "pollinations", "curated"])
    .optional(),
  image_base_url: z.string().optional(),
  image_api_key: z.string().optional(),
  image_model: z.string().optional(),

  tts_provider: z.enum(["auto", "elevenlabs", "gemini", "openai", "edge_neural"]).optional(),
  elevenlabs_api_key: z.string().optional(),
  elevenlabs_model: z.string().optional(),
  gemini_tts_model: z.string().optional(),
  tts_base_url: z.string().optional(),
  tts_api_key: z.string().optional(),
  tts_model: z.string().optional(),

  media_video_endpoint: z.string().optional(),
  speed_multiplier: z.number().min(1).max(30).optional(),
  plan_tier: z.enum(["free", "pro"]).optional(),
  test_voice_persona_id: z.string().optional(),
  boost_persona: z
    .object({
      persona_id: z.string(),
      affinity: z.number().int().min(0).max(100),
      trust: z.number().int().min(0).max(100).optional(),
      romantic_tension: z.number().int().min(0).max(100).optional(),
    })
    .optional(),
  reset_world: z.boolean().optional(),
});

export async function GET() {
  const cfg = getRuntimeConfig();
  const effective = getEffectiveLlmMode();
  return NextResponse.json({
    llm_provider: cfg.llmProvider,
    effective_mode: effective.mode,
    image_mode: effective.imageMode,
    tts_mode: effective.ttsMode,
    has_gemini_key: Boolean(cfg.geminiApiKey),
    has_openai_key: Boolean(cfg.llmApiKey),
    has_fallback_key: effective.hasFallbackKey,
    fallback_model: effective.fallbackModel,
    has_image_key: Boolean(cfg.imageApiKey || cfg.geminiApiKey),
    has_elevenlabs_key: Boolean(cfg.elevenLabsApiKey),
    has_tts_key: Boolean(cfg.ttsApiKey),
    gemini_roleplay_model: cfg.geminiRoleplayModel,
    gemini_fast_model: cfg.geminiFastModel,
    gemini_embedding_model: cfg.geminiEmbeddingModel,
    llm_base_url: cfg.llmBaseUrl,
    llm_roleplay_model: cfg.llmRoleplayModel,
    llm_fast_model: cfg.llmFastModel,
    image_provider: cfg.imageProvider,
    image_base_url: cfg.imageBaseUrl,
    image_model: cfg.imageModel,
    tts_provider: cfg.ttsProvider,
    elevenlabs_model: cfg.elevenLabsModel,
    gemini_tts_model: cfg.geminiTtsModel,
    tts_base_url: cfg.ttsBaseUrl,
    tts_model: cfg.ttsModel,
    media_video_endpoint: cfg.mediaVideoEndpoint,
    speed_multiplier: cfg.speedMultiplier,
  });
}

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = settingsPatchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid settings payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const d = parsed.data;
    updateRuntimeConfig({
      llmProvider: d.llm_provider,
      geminiApiKey: d.gemini_api_key,
      geminiRoleplayModel: d.gemini_roleplay_model,
      geminiFastModel: d.gemini_fast_model,
      geminiEmbeddingModel: d.gemini_embedding_model,
      llmBaseUrl: d.llm_base_url,
      llmApiKey: d.llm_api_key,
      llmRoleplayModel: d.llm_roleplay_model,
      llmFastModel: d.llm_fast_model,
      imageProvider: d.image_provider,
      imageBaseUrl: d.image_base_url,
      imageApiKey: d.image_api_key,
      imageModel: d.image_model,
      ttsProvider: d.tts_provider,
      elevenLabsApiKey: d.elevenlabs_api_key,
      elevenLabsModel: d.elevenlabs_model,
      geminiTtsModel: d.gemini_tts_model,
      ttsBaseUrl: d.tts_base_url,
      ttsApiKey: d.tts_api_key,
      ttsModel: d.tts_model,
      mediaVideoEndpoint: d.media_video_endpoint,
      speedMultiplier: d.speed_multiplier,
    });

    if (d.test_voice_persona_id) {
      const persona = await dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [
        d.test_voice_persona_id,
      ]);
      if (persona) {
        const sample = await synthesizePersonaVoiceNote(
          persona,
          `Hey, this is ${persona.display_name.split(" ")[0]} testing my real voice note on Vela.`
        );
        return NextResponse.json({ ok: true, voice_sample: sample });
      }
    }

    const user = await getActiveUser();

    if (user && d.plan_tier) {
      const nextMax = d.plan_tier === "pro" ? 100 : 20;
      await dbQuery(
        `UPDATE users
         SET plan_tier = $2, max_energy = $3, energy = GREATEST(energy, $3)
         WHERE id = $1`,
        [user.id, d.plan_tier, nextMax]
      );
    }

    let boostedTier = null;
    if (user && d.boost_persona) {
      const aff = d.boost_persona.affinity;
      const trust = d.boost_persona.trust ?? Math.min(100, Math.round(aff * 0.85));
      const rom = d.boost_persona.romantic_tension ?? 0;
      const stage = computeRelationshipStage(aff, rom);
      const followsBack = aff >= 18;
      await dbQuery(
        `UPDATE user_persona_state
         SET affinity = $3,
             trust = $4,
             romantic_tension = $5,
             relationship_stage = $6,
             persona_follows_back = CASE WHEN $7 THEN TRUE ELSE persona_follows_back END,
             updated_at = NOW()
         WHERE user_id = $1 AND persona_id = $2`,
        [user.id, d.boost_persona.persona_id, aff, trust, rom, stage, followsBack]
      );
      boostedTier = getMediaUnlockTier(aff, rom);
    }

    if (user && d.reset_world) {
      await dbQuery("DELETE FROM users WHERE id = $1", [user.id]);
      const res = NextResponse.json({ reset: true });
      res.cookies.delete(SESSION_COOKIE_NAME);
      return res;
    }

    const effective = getEffectiveLlmMode();
    const cfg = getRuntimeConfig();
    return NextResponse.json({
      ok: true,
      effective_mode: effective.mode,
      image_mode: effective.imageMode,
      tts_mode: effective.ttsMode,
      llm_provider: cfg.llmProvider,
      speed_multiplier: cfg.speedMultiplier,
      boosted_tier: boostedTier,
    });
  } catch (err) {
    console.error("[POST /api/v1/dev/settings] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update settings" },
      { status: 500 }
    );
  }
}
