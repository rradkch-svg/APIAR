import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getRuntimeConfig } from "../config/runtime";
import type { PersonaRow } from "../personas/metadata";

export interface PersonaVoiceMapping {
  edgeVoice: string;
  geminiVoice: string;
  openaiVoice: "alloy" | "ash" | "ballad" | "coral" | "echo" | "fable" | "nova" | "onyx" | "sage" | "shimmer" | "verse";
  elevenLabsVoiceId: string;
  pitchOffset: string; // Edge SSML pitch e.g. "+0Hz", "-2Hz"
  rateOffset: string;  // Edge SSML rate e.g. "+4%", "-6%"
}

/**
 * 22 UNIQUE real human neural voices — one distinct voice per campus persona
 * across Microsoft Edge Neural (zero-key default), Gemini TTS, OpenAI TTS, and ElevenLabs.
 */
export const PERSONA_VOICE_MAP: Record<string, PersonaVoiceMapping> = {
  // Females (11 distinct neural voices)
  chloe:  { edgeVoice: "en-US-JennyNeural",            geminiVoice: "Kore",       openaiVoice: "coral",   elevenLabsVoiceId: "EXAVITQu4vr4xnSDxMaL", pitchOffset: "-1Hz", rateOffset: "+3%" },
  nina:   { edgeVoice: "en-US-MichelleNeural",         geminiVoice: "Leda",       openaiVoice: "sage",    elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM", pitchOffset: "+1Hz", rateOffset: "+8%" },
  bella:  { edgeVoice: "en-US-AriaNeural",             geminiVoice: "Aoede",      openaiVoice: "shimmer", elevenLabsVoiceId: "AZnzlk1XvdvUeBnXmlld", pitchOffset: "+3Hz", rateOffset: "+10%" },
  jade:   { edgeVoice: "en-US-AvaNeural",              geminiVoice: "Despina",    openaiVoice: "nova",    elevenLabsVoiceId: "MF3mGyEYCl7XYWbV9V6O", pitchOffset: "+1Hz", rateOffset: "-4%" },
  lauren: { edgeVoice: "en-US-EmmaNeural",             geminiVoice: "Callirrhoe", openaiVoice: "alloy",   elevenLabsVoiceId: "ThT5KcBeYPX3keUQqHPh", pitchOffset: "+0Hz", rateOffset: "-2%" },
  sofia:  { edgeVoice: "en-GB-SoniaNeural",            geminiVoice: "Autonoe",    openaiVoice: "ballad",  elevenLabsVoiceId: "pMsXgVXv3BLzUgSXRplE", pitchOffset: "-2Hz", rateOffset: "-5%" },
  camila: { edgeVoice: "en-CA-ClaraNeural",            geminiVoice: "Erinome",    openaiVoice: "sage",    elevenLabsVoiceId: "jsCqWAovK2LkecY7zXl4", pitchOffset: "+0Hz", rateOffset: "+6%" },
  maya:   { edgeVoice: "en-US-AvaMultilingualNeural",  geminiVoice: "Zephyr",     openaiVoice: "coral",   elevenLabsVoiceId: "oWAxZDx7w5VEj9dCyTzz", pitchOffset: "-3Hz", rateOffset: "-8%" },
  claire: { edgeVoice: "en-AU-NatashaNeural",          geminiVoice: "Laomedeia",  openaiVoice: "nova",    elevenLabsVoiceId: "XB0fDUnXU5powFXDhCwa", pitchOffset: "-1Hz", rateOffset: "-7%" },
  helena: { edgeVoice: "en-GB-LibbyNeural",            geminiVoice: "Achernar",   openaiVoice: "alloy",   elevenLabsVoiceId: "XrExE9yKIg1WjnnlVkGX", pitchOffset: "+0Hz", rateOffset: "-1%" },
  mel:    { edgeVoice: "en-US-EmmaMultilingualNeural", geminiVoice: "Vindemiatrix", openaiVoice: "shimmer", elevenLabsVoiceId: "jBpfuIE2acCO8z3wKNLl", pitchOffset: "+2Hz", rateOffset: "+2%" },

  // Males (11 distinct neural voices)
  leo:    { edgeVoice: "en-US-AndrewNeural",              geminiVoice: "Puck",      openaiVoice: "echo",   elevenLabsVoiceId: "TxGEqnHWrfWFTfGW9XjX", pitchOffset: "-2Hz", rateOffset: "-5%" },
  theo:   { edgeVoice: "en-US-SteffanNeural",             geminiVoice: "Orus",      openaiVoice: "verse",  elevenLabsVoiceId: "ErXwobaYiN019PkySvjV", pitchOffset: "-3Hz", rateOffset: "-6%" },
  brody:  { edgeVoice: "en-US-GuyNeural",                 geminiVoice: "Fenrir",    openaiVoice: "ash",    elevenLabsVoiceId: "VR6AewLTigWG4xSOukaG", pitchOffset: "-1Hz", rateOffset: "+7%" },
  ezra:   { edgeVoice: "en-US-ChristopherNeural",         geminiVoice: "Charon",    openaiVoice: "onyx",   elevenLabsVoiceId: "VR6AewLTigWG4xSOukaG", pitchOffset: "-4Hz", rateOffset: "-8%" },
  matty:  { edgeVoice: "en-CA-LiamNeural",                geminiVoice: "Iapetus",   openaiVoice: "fable",  elevenLabsVoiceId: "yoZ06aMxZJJ28mfd3POQ", pitchOffset: "+2Hz", rateOffset: "+12%" },
  cole:   { edgeVoice: "en-US-EricNeural",                geminiVoice: "Umbriel",   openaiVoice: "onyx",   elevenLabsVoiceId: "pNInz6obpgDQGcFmaJgB", pitchOffset: "-2Hz", rateOffset: "+2%" },
  victor: { edgeVoice: "en-GB-RyanNeural",                geminiVoice: "Algenib",   openaiVoice: "ash",    elevenLabsVoiceId: "onwK4e9ZLuTAKqWW03F9", pitchOffset: "-1Hz", rateOffset: "+5%" },
  gabe:   { edgeVoice: "en-US-BrianNeural",               geminiVoice: "Algieba",   openaiVoice: "verse",  elevenLabsVoiceId: "N2lVS1w4EtoT3dr4eOWO", pitchOffset: "+0Hz", rateOffset: "+4%" },
  trey:   { edgeVoice: "en-US-AndrewMultilingualNeural",  geminiVoice: "Alnilam",   openaiVoice: "echo",   elevenLabsVoiceId: "IKne3meq5aSn9XLyUdCD", pitchOffset: "-2Hz", rateOffset: "+8%" },
  lucas:  { edgeVoice: "en-US-BrianMultilingualNeural",   geminiVoice: "Schedar",   openaiVoice: "fable",  elevenLabsVoiceId: "bIHbv24MWmeRgasZH58o", pitchOffset: "-1Hz", rateOffset: "+2%" },
  parker: { edgeVoice: "en-AU-WilliamMultilingualNeural", geminiVoice: "Gacrux",    openaiVoice: "echo",   elevenLabsVoiceId: "SOYHLrjzK2X1ezoPC6cr", pitchOffset: "+1Hz", rateOffset: "+9%" },
};

function getAudioDir(): string {
  const dir = path.resolve(process.cwd(), ".vela-media", "audio");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pcm16ToWav(pcmBuffer: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

function estimateSpeechDurationSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(4, Math.min(25, Math.round(words / 2.5) + 1));
}

export interface SynthesizedVoiceNote {
  audioUrl: string | null;
  durationSec: number;
  providerUsed: "elevenlabs" | "gemini_tts" | "openai_tts" | "edge_neural" | "none";
  voiceName: string;
}

/**
 * Generates a REAL human neural audio file (.mp3 or .wav) uniquely voiced per persona.
 * Priority:
 * 1. ElevenLabs (if TTS_PROVIDER=elevenlabs & ELEVENLABS_API_KEY set)
 * 2. OpenAI / Compatible Neural TTS (if TTS_PROVIDER=openai & TTS_API_KEY set)
 * 3. Gemini Native Expressive TTS (if TTS_PROVIDER=gemini & GEMINI_API_KEY set)
 * 4. Microsoft Edge Neural TTS via msedge-tts (free real 22-voice human MP3 fallback!)
 */
export async function synthesizePersonaVoiceNote(
  persona: PersonaRow,
  script: string
): Promise<SynthesizedVoiceNote> {
  const cfg = getRuntimeConfig();
  const mapping = PERSONA_VOICE_MAP[persona.id] || PERSONA_VOICE_MAP.chloe;
  const cleanScript = script
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);

  const hash = crypto
    .createHash("sha256")
    .update(`${persona.id}:${cfg.ttsProvider}:${cleanScript}`)
    .digest("hex")
    .slice(0, 16);

  const dir = getAudioDir();
  const estDuration = estimateSpeechDurationSec(cleanScript);

  // 1. ElevenLabs Neural TTS
  if (cfg.ttsProvider === "elevenlabs" && cfg.elevenLabsApiKey) {
    const filename = `${persona.id}-el-${hash}.mp3`;
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      return {
        audioUrl: `/api/v1/media/files/audio/${filename}`,
        durationSec: estDuration,
        providerUsed: "elevenlabs",
        voiceName: mapping.elevenLabsVoiceId,
      };
    }
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${mapping.elevenLabsVoiceId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": cfg.elevenLabsApiKey,
          },
          body: JSON.stringify({
            text: cleanScript,
            model_id: cfg.elevenLabsModel || "eleven_flash_v2_5",
            voice_settings: { stability: 0.45, similarity_boost: 0.78, style: 0.35 },
          }),
          signal: AbortSignal.timeout(20000),
        }
      );
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 500) {
          fs.writeFileSync(filePath, buf);
          return {
            audioUrl: `/api/v1/media/files/audio/${filename}`,
            durationSec: estDuration,
            providerUsed: "elevenlabs",
            voiceName: mapping.elevenLabsVoiceId,
          };
        }
      }
    } catch (err) {
      console.warn("[tts-engine] ElevenLabs failed, falling back to Edge Neural:", err);
    }
  }

  // 2. OpenAI / Compatible Neural TTS
  if (cfg.ttsProvider === "openai" && cfg.ttsApiKey) {
    const filename = `${persona.id}-oai-${hash}.mp3`;
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      return {
        audioUrl: `/api/v1/media/files/audio/${filename}`,
        durationSec: estDuration,
        providerUsed: "openai_tts",
        voiceName: mapping.openaiVoice,
      };
    }
    try {
      const base = cfg.ttsBaseUrl || "https://api.openai.com/v1";
      const res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.ttsApiKey}`,
        },
        body: JSON.stringify({
          model: cfg.ttsModel || "gpt-4o-mini-tts",
          voice: mapping.openaiVoice,
          input: cleanScript,
          instructions: `Speak naturally like a ${persona.age}-year-old US college student leaving a casual voice note. Tone: ${persona.voice_profile?.tone || "casual natural"}.`,
          response_format: "mp3",
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 500) {
          fs.writeFileSync(filePath, buf);
          return {
            audioUrl: `/api/v1/media/files/audio/${filename}`,
            durationSec: estDuration,
            providerUsed: "openai_tts",
            voiceName: mapping.openaiVoice,
          };
        }
      }
    } catch (err) {
      console.warn("[tts-engine] OpenAI TTS failed, falling back to Edge Neural:", err);
    }
  }

  // 3. Gemini Native TTS (uses same GEMINI_API_KEY, 22 distinct expressive prebuilt voices!)
  // Automatically tries gemini-3.8-flash-tts -> gemini-3.8-flash-lite-tts, then falls back to free Edge Neural!
  if (cfg.ttsProvider === "gemini" && cfg.geminiApiKey) {
    const filename = `${persona.id}-gem-${hash}.wav`;
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      return {
        audioUrl: `/api/v1/media/files/audio/${filename}`,
        durationSec: estDuration,
        providerUsed: "gemini_tts",
        voiceName: mapping.geminiVoice,
      };
    }
    const ttsModels = Array.from(
      new Set([
        cfg.geminiTtsModel || "gemini-3.8-flash-tts",
        "gemini-3.8-flash-lite-tts",
        "gemini-2.5-flash-preview-tts",
      ])
    );
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
    for (const ttsModel of ttsModels) {
      try {
        const res = await ai.models.generateContent({
          model: ttsModel,
          contents: `Deliver this casual college voice note naturally (${persona.voice_profile?.style_notes || "relaxed"}): ${cleanScript}`,
          config: {
            abortSignal: AbortSignal.timeout(14000),
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: mapping.geminiVoice,
                },
              },
            },
          },
        });
        const inline = res.candidates?.[0]?.content?.parts?.find(
          (p) => p.inlineData?.data
        )?.inlineData;
        if (inline?.data) {
          const rawBuf = Buffer.from(inline.data, "base64");
          const isWav = inline.mimeType?.includes("wav") || rawBuf.slice(0, 4).toString() === "RIFF";
          const outBuf = isWav ? rawBuf : pcm16ToWav(rawBuf, 24000, 1);
          fs.writeFileSync(filePath, outBuf);
          // 24kHz 16-bit mono PCM = 48000 bytes/sec
          const exactDur = Math.max(3, Math.min(25, Math.round((outBuf.length - 44) / 48000)));
          return {
            audioUrl: `/api/v1/media/files/audio/${filename}`,
            durationSec: exactDur,
            providerUsed: "gemini_tts",
            voiceName: mapping.geminiVoice,
          };
        }
      } catch (err) {
        console.warn(`[tts-engine] Gemini TTS (${ttsModel}) failed:`, err instanceof Error ? err.message.slice(0, 110) : err);
      }
    }
  }

  // 4. Free Real Human Neural Voice Fallback: Microsoft Edge Neural TTS (.mp3)
  const edgeFilename = `${persona.id}-edge-${hash}.mp3`;
  const edgePath = path.join(dir, edgeFilename);
  if (fs.existsSync(edgePath)) {
    return {
      audioUrl: `/api/v1/media/files/audio/${edgeFilename}`,
      durationSec: estDuration,
      providerUsed: "edge_neural",
      voiceName: mapping.edgeVoice,
    };
  }

  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const tts = new MsEdgeTTS();
    await tts.setMetadata(mapping.edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(cleanScript, {
      rate: mapping.rateOffset,
      pitch: mapping.pitchOffset,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const mp3 = Buffer.concat(chunks);
    if (mp3.length > 400) {
      fs.writeFileSync(edgePath, mp3);
      // MP3 at 48kbps = 6000 bytes/sec
      const exactDur = Math.max(3, Math.min(25, Math.round(mp3.length / 6000)));
      return {
        audioUrl: `/api/v1/media/files/audio/${edgeFilename}`,
        durationSec: exactDur,
        providerUsed: "edge_neural",
        voiceName: mapping.edgeVoice,
      };
    }
  } catch (err) {
    console.warn("[tts-engine] Edge Neural TTS failed:", err);
  }

  return {
    audioUrl: null,
    durationSec: estDuration,
    providerUsed: "none",
    voiceName: mapping.edgeVoice,
  };
}
