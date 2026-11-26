import { getRuntimeConfig } from "../config/runtime";
import type { PersonaRow } from "../personas/metadata";
import type { MediaAttachmentDraft, MediaTierInfo } from "./tiers";
import { synthesizePersonaVoiceNote } from "./tts-engine";
import { generatePhotorealisticImage } from "./image-engine";

export interface ResolvedMediaAsset {
  messageType: "image" | "audio" | "video";
  body: string;
  mediaUrl: string | null;
  mediaMetadata: Record<string, unknown>;
}

function deterministicWaveform(seedText: string, bars = 28): number[] {
  let h = 5381;
  for (let i = 0; i < seedText.length; i++) {
    h = (h * 33) ^ seedText.charCodeAt(i);
  }
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    const envelope = Math.sin(((i + 1) / (bars + 1)) * Math.PI);
    const val = 0.22 + ((h % 100) / 100) * 0.65 * (0.45 + 0.55 * envelope);
    out.push(Number(Math.min(1, Math.max(0.18, val)).toFixed(2)));
  }
  return out;
}

/**
 * Resolves an approved DM media attachment into real neural audio (.mp3/.wav),
 * photorealistic photographs (AI-generated or curated real JPG), or short video notes.
 * ZERO fake SVG scenes, ZERO robotic browser speechSynthesis!
 */
export async function resolveMediaAttachment(
  persona: PersonaRow,
  attachment: MediaAttachmentDraft,
  tier: MediaTierInfo
): Promise<ResolvedMediaAsset> {
  const cfg = getRuntimeConfig();

  // 1. REAL NEURAL AUDIO (22 distinct human voices via ElevenLabs / Gemini TTS / OpenAI TTS / Edge Neural)
  if (attachment.type === "audio") {
    const transcript = attachment.prompt_or_script;
    const waveform = deterministicWaveform(`${persona.id}:${transcript}`);
    const synth = await synthesizePersonaVoiceNote(persona, transcript);

    return {
      messageType: "audio",
      body: transcript,
      mediaUrl: synth.audioUrl,
      mediaMetadata: {
        mode: synth.providerUsed,
        voice_name: synth.voiceName,
        duration_sec: synth.durationSec,
        transcript,
        voice_profile: persona.voice_profile,
        waveform,
        unlocked_tier: tier.tierId,
      },
    };
  }

  // 2. REAL PHOTOREALISTIC PHOTO (Live AI Imagen/OpenAI/Grok OR real local campus JPG)
  if (attachment.type === "image") {
    const viewOnce = Boolean(attachment.view_once);
    const sceneKind: "ambient" | "selfie" | "view_once" = viewOnce
      ? "view_once"
      : tier.allowSelfie && /selfie|mirror|face|me|fit check|smile|eyes/i.test(attachment.prompt_or_script)
        ? "selfie"
        : "ambient";

    const photo = await generatePhotorealisticImage({
      persona,
      prompt: attachment.prompt_or_script,
      sceneKind,
    });

    return {
      messageType: "image",
      body: attachment.prompt_or_script,
      mediaUrl: photo.imageUrl,
      mediaMetadata: {
        mode: photo.providerUsed,
        visual_prompt: attachment.prompt_or_script,
        visual_anchor: persona.visual_anchor,
        view_once: viewOnce,
        viewed_at: null,
        scene_kind: sceneKind,
        location: photo.location,
        unlocked_tier: tier.tierId,
      },
    };
  }

  // 3. VIDEO NOTE (Live webhook OR photorealistic Ken Burns clip + real neural MP3 voice track!)
  const durationSec = attachment.duration_sec ?? 5;
  const combinedPrompt = `${persona.visual_anchor}. Short ${durationSec}s vertical video note: ${attachment.prompt_or_script}`;

  if (cfg.mediaVideoEndpoint) {
    try {
      const res = await fetch(cfg.mediaVideoEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: combinedPrompt,
          duration_sec: durationSec,
          persona_id: persona.id,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = (await res.json()) as { video_url?: string };
        if (data.video_url) {
          return {
            messageType: "video",
            body: attachment.prompt_or_script,
            mediaUrl: data.video_url,
            mediaMetadata: {
              mode: "live_video",
              duration_sec: durationSec,
              transcript: attachment.prompt_or_script,
              visual_prompt: attachment.prompt_or_script,
              visual_anchor: persona.visual_anchor,
              unlocked_tier: tier.tierId,
            },
          };
        }
      }
    } catch (err) {
      console.warn("[media] Live video webhook failed, using photorealistic clip + neural voice:", err);
    }
  }

  const [photo, voice] = await Promise.all([
    generatePhotorealisticImage({
      persona,
      prompt: attachment.prompt_or_script,
      sceneKind: "selfie",
    }),
    synthesizePersonaVoiceNote(persona, attachment.prompt_or_script),
  ]);

  return {
    messageType: "video",
    body: attachment.prompt_or_script,
    mediaUrl: photo.imageUrl,
    mediaMetadata: {
      mode: "photorealistic_clip",
      audio_url: voice.audioUrl,
      duration_sec: durationSec,
      transcript: attachment.prompt_or_script,
      visual_prompt: attachment.prompt_or_script,
      visual_anchor: persona.visual_anchor,
      unlocked_tier: tier.tierId,
    },
  };
}
