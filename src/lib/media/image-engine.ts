import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getRuntimeConfig } from "../config/runtime";
import type { PersonaRow } from "../personas/metadata";

interface CuratedPhotoEntry {
  file: string;
  tags: string[];
  cliques: string[];
  location: string;
}

const CURATED_CAMPUS_PHOTOS: CuratedPhotoEntry[] = [
  { file: "/photos/coffee-quad.jpg", tags: ["coffee", "latte", "morning", "quad", "cafe", "study", "chloe", "leo"], cliques: ["campus"], location: "West Quad Café" },
  { file: "/photos/iced-latte-desk.jpg", tags: ["iced", "coffee", "latte", "desk", "notebook", "study", "mel", "chloe"], cliques: ["campus", "tech"], location: "Student Union" },
  { file: "/photos/matcha-cafe.jpg", tags: ["matcha", "aesthetic", "pilates", "cafe", "jade", "bella", "lauren"], cliques: ["influencers"], location: "Oat & Bloom Matcha" },
  { file: "/photos/espresso-bar.jpg", tags: ["espresso", "barista", "cafe", "quiet", "claire", "coffee", "indie"], cliques: ["arts"], location: "Elm St. Espresso" },
  { file: "/photos/pour-over.jpg", tags: ["pour", "coffee", "morning", "calm", "leo", "claire"], cliques: ["campus", "arts"], location: "Foundry Roasters" },
  { file: "/photos/campus-quad-sun.jpg", tags: ["campus", "quad", "sun", "walk", "class", "college", "afternoon"], cliques: ["campus", "influencers"], location: "Main Quad" },
  { file: "/photos/library-stacks.jpg", tags: ["library", "books", "law", "exam", "calc", "study", "nina", "camila", "helena"], cliques: ["campus", "drama", "tech"], location: "Alden Library · 4F" },
  { file: "/photos/study-notes.jpg", tags: ["notes", "calc", "midterm", "paper", "planner", "notion", "nina", "chloe"], cliques: ["campus", "tech"], location: "Commons Study Hall" },
  { file: "/photos/autumn-walkway.jpg", tags: ["walkway", "golden", "hour", "campus", "shoot", "bella", "lauren"], cliques: ["campus", "influencers"], location: "North Campus Walk" },
  { file: "/photos/sunset-rooftop.jpg", tags: ["sunset", "rooftop", "golden", "terrace", "evening", "theo", "sofia", "victor"], cliques: ["drama", "campus", "influencers"], location: "West Terrace Rooftop" },
  { file: "/photos/night-balcony.jpg", tags: ["night", "balcony", "twilight", "city", "3am", "theo", "sofia", "late"], cliques: ["campus", "drama"], location: "South Hall Balcony" },
  { file: "/photos/backyard-lights.jpg", tags: ["tailgate", "backyard", "party", "lights", "friday", "brody", "hangout"], cliques: ["campus", "influencers"], location: "Cedar St. House" },
  { file: "/photos/dj-booth-club.jpg", tags: ["dj", "set", "club", "electronic", "friday", "vip", "afterparty", "trey"], cliques: ["arts", "influencers"], location: "The Basement Lounge" },
  { file: "/photos/house-party-crowd.jpg", tags: ["party", "crowd", "night", "music", "weekend", "brody", "trey", "matty"], cliques: ["campus", "influencers", "arts"], location: "Oak Ave Off-Campus" },
  { file: "/photos/city-dusk.jpg", tags: ["dusk", "evening", "skyline", "drive", "car", "victor", "cole"], cliques: ["drama"], location: "Downtown Overlook" },
  { file: "/photos/guitar-studio.jpg", tags: ["guitar", "band", "rehearsal", "rock", "music", "indie", "gabe", "leo"], cliques: ["arts", "campus"], location: "Garage Practice Room" },
  { file: "/photos/vinyl-records.jpg", tags: ["vinyl", "album", "music", "indie", "chill", "gabe", "maya", "claire"], cliques: ["arts"], location: "Spin & Ink Records" },
  { file: "/photos/art-sketchbook.jpg", tags: ["sketch", "tattoo", "ink", "draw", "art", "3am", "studio", "maya"], cliques: ["arts"], location: "Arts Annex Studio" },
  { file: "/photos/indie-cinema.jpg", tags: ["cinema", "movie", "film", "a24", "letterboxd", "theater", "claire", "ezra"], cliques: ["arts", "influencers"], location: "Bijou Indie Cinema" },
  { file: "/photos/film-camera-night.jpg", tags: ["camera", "35mm", "photo", "flash", "street", "ezra", "raw"], cliques: ["influencers", "arts"], location: "College Ave" },
  { file: "/photos/rainy-cafe-window.jpg", tags: ["rain", "window", "moody", "quiet", "night", "claire", "maya"], cliques: ["arts"], location: "Elm St. Espresso" },
  { file: "/photos/dual-monitor-night.jpg", tags: ["code", "compile", "bug", "dev", "setup", "2am", "lucas", "tech"], cliques: ["tech"], location: "CS Lab · 2AM" },
  { file: "/photos/gaming-desk.jpg", tags: ["game", "ranked", "valorant", "duo", "pc", "elo", "lucas", "parker", "matty"], cliques: ["tech", "influencers"], location: "North Dorm 4B" },
  { file: "/photos/design-ipad-desk.jpg", tags: ["figma", "design", "ipad", "pixel", "aesthetic", "mel", "lauren"], cliques: ["tech", "influencers"], location: "Design Studio" },
  { file: "/photos/dnd-dice-table.jpg", tags: ["dnd", "dice", "rpg", "campaign", "theory", "table", "parker"], cliques: ["tech"], location: "Rec Room Table 2" },
  { file: "/photos/science-lab.jpg", tags: ["lab", "science", "research", "data", "experiment", "helena"], cliques: ["tech"], location: "Benson Research Lab" },
  { file: "/photos/pilates-studio.jpg", tags: ["pilates", "workout", "morning", "wellness", "jade", "bella"], cliques: ["influencers"], location: "Form Pilates Studio" },
  { file: "/photos/indie-bookstore.jpg", tags: ["book", "bookstore", "reading", "routine", "lauren", "claire"], cliques: ["influencers", "arts"], location: "Chapter One Books" },
  { file: "/photos/pizza-hangout.jpg", tags: ["pizza", "food", "late", "friends", "brody", "matty"], cliques: ["campus", "influencers"], location: "Sal's Late Night Slice" },
  { file: "/photos/gym-evening.jpg", tags: ["gym", "lift", "training", "grind", "cole", "victor"], cliques: ["drama"], location: "Campus Rec Center" },
];

function getImageDir(): string {
  const dir = path.resolve(process.cwd(), ".vela-media", "images");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function pickRealisticFallbackPhoto(params: {
  persona: PersonaRow;
  prompt: string;
  sceneKind?: "post" | "ambient" | "selfie" | "view_once" | "video" | "story";
  excludeUrls?: string[];
}): { imageUrl: string; location: string } {
  const { persona, prompt, sceneKind, excludeUrls = [] } = params;
  const excludeSet = new Set(excludeUrls);

  // For selfies / close personal snaps / video notes, use the persona's real photorealistic portrait!
  if ((sceneKind === "selfie" || sceneKind === "view_once") && persona.avatar_url) {
    return {
      imageUrl: persona.avatar_url,
      location: "Campus",
    };
  }

  const lower = `${prompt} ${persona.id} ${persona.bio} ${persona.clique}`.toLowerCase();
  const candidates = CURATED_CAMPUS_PHOTOS.filter((e) => !excludeSet.has(e.file));
  const pool = candidates.length > 0 ? candidates : CURATED_CAMPUS_PHOTOS;

  const scored = pool.map((entry) => {
    let score = 0;
    for (const tag of entry.tags) {
      if (lower.includes(tag)) score += tag === persona.id ? 4 : 4;
    }
    if (entry.cliques.includes(persona.clique)) score += 1.5;
    let h = 0;
    const key = `${entry.file}:${prompt.slice(0, 50)}`;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    score += (Math.abs(h) % 100) / 100;
    return { entry, score };
  }).sort((a, b) => b.score - a.score);

  const chosen = scored[0]?.entry || CURATED_CAMPUS_PHOTOS[0];
  return { imageUrl: chosen.file, location: chosen.location };
}

export interface GeneratedPhotoResult {
  imageUrl: string;
  location: string;
  providerUsed: "gemini_image" | "openai_image" | "pollinations_flux" | "curated_real_photo";
}

let geminiImageQuotaBlockedUntil = 0;
let lastPollinationsCallAt = 0;

/**
 * Generates a photorealistic candid iPhone-style photo for Feed Posts, Stories, or DM Attachments.
 * - Live mode: Gemini Imagen / Nano Banana, OpenAI-compatible Images API, or Free Pollinations FLUX.
 * - Curated mode (zero-cost watermark-free default): semantically matched real high-res local campus photograph from /photos/*.jpg (ZERO SVGs!).
 */
export async function generatePhotorealisticImage(params: {
  persona: PersonaRow;
  prompt: string;
  sceneKind: "post" | "ambient" | "selfie" | "view_once" | "video" | "story";
  excludeUrls?: string[];
}): Promise<GeneratedPhotoResult> {
  const cfg = getRuntimeConfig();
  const { persona, prompt, sceneKind, excludeUrls } = params;
  const fallback = pickRealisticFallbackPhoto({ persona, prompt, sceneKind, excludeUrls });

  const fullPrompt =
    sceneKind === "ambient" || sceneKind === "post"
      ? `Candid authentic college smartphone photograph (35mm lens feel, natural available light, slight film grain, unposed real life Instagram photo, no text, no watermark): ${prompt}. Aesthetic context: ${persona.visual_anchor}.`
      : `Candid authentic smartphone photo featuring ${persona.visual_anchor}. Scene: ${prompt}. Natural lighting, realistic skin texture, real Instagram photography, no text, no watermark.`;

  const hash = crypto
    .createHash("sha256")
    .update(`${persona.id}:${sceneKind}:${prompt.slice(0, 120)}`)
    .digest("hex")
    .slice(0, 14);

  const dir = getImageDir();

  // 1. Live Gemini Image Generation (uses GEMINI_API_KEY + IMAGE_PROVIDER=gemini)
  if (cfg.imageProvider === "gemini" && cfg.geminiApiKey && Date.now() > geminiImageQuotaBlockedUntil) {
    const filename = `${persona.id}-gem-${hash}.jpg`;
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      return {
        imageUrl: `/api/v1/media/files/images/${filename}`,
        location: fallback.location,
        providerUsed: "gemini_image",
      };
    }
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
      const model = cfg.imageModel || "gemini-3.1-flash-image";

      if (model.startsWith("imagen")) {
        const res = await ai.models.generateImages({
          model,
          prompt: fullPrompt,
          config: { numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio: "1:1" },
        });
        const b64 = res.generatedImages?.[0]?.image?.imageBytes;
        if (b64) {
          fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
          return {
            imageUrl: `/api/v1/media/files/images/${filename}`,
            location: fallback.location,
            providerUsed: "gemini_image",
          };
        }
      } else {
        // Nano Banana / gemini-*-image generateContent path with portrait reference lock for selfies/stories!
        const contents: Array<string | { inlineData: { mimeType: string; data: string } }> = [];
        if (
          (sceneKind === "selfie" || sceneKind === "view_once" || sceneKind === "video") &&
          persona.avatar_url?.startsWith("/avatars/")
        ) {
          const refPath = path.join(process.cwd(), "public", persona.avatar_url.replace(/^\/+/, ""));
          if (fs.existsSync(refPath)) {
            contents.push({
              inlineData: {
                mimeType: "image/jpeg",
                data: fs.readFileSync(refPath).toString("base64"),
              },
            });
            contents.push(
              `Preserve the exact facial identity, hair, and likeness of the person in the reference portrait. ${fullPrompt}`
            );
          } else {
            contents.push(fullPrompt);
          }
        } else {
          contents.push(fullPrompt);
        }

        const res = await ai.models.generateContent({
          model,
          contents,
          config: { responseModalities: ["IMAGE"] },
        });
        const imgPart = res.candidates?.[0]?.content?.parts?.find(
          (p) => p.inlineData?.data
        )?.inlineData;
        if (imgPart?.data) {
          fs.writeFileSync(filePath, Buffer.from(imgPart.data, "base64"));
          return {
            imageUrl: `/api/v1/media/files/images/${filename}`,
            location: fallback.location,
            providerUsed: "gemini_image",
          };
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") || msg.includes("quota")) {
        geminiImageQuotaBlockedUntil = Date.now() + 15 * 60 * 1000;
      }
      console.warn("[image-engine] Gemini image gen failed, using curated real photo:", msg.slice(0, 140));
    }
  }

  // 2. Free Pollinations FLUX (optional opt-in: 1 image / 45s free tier, cached on disk)
  if (cfg.imageProvider === "pollinations") {
    const filename = `${persona.id}-flux-${hash}.jpg`;
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      return {
        imageUrl: `/api/v1/media/files/images/${filename}`,
        location: fallback.location,
        providerUsed: "pollinations_flux",
      };
    }
    if (Date.now() - lastPollinationsCallAt >= 46000) {
      lastPollinationsCallAt = Date.now();
      try {
        const seed = parseInt(hash.slice(0, 6), 16) % 99999;
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
          fullPrompt.slice(0, 320)
        )}?width=768&height=768&model=flux&nologo=true&seed=${seed}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(22000) });
        const ct = res.headers.get("content-type") || "";
        if (res.ok && ct.startsWith("image/")) {
          const buf = Buffer.from(await res.arrayBuffer());
          const isJpeg = buf.length > 8000 && buf[0] === 0xff && buf[1] === 0xd8;
          const isPng = buf.length > 8000 && buf[0] === 0x89 && buf[1] === 0x50;
          if (isJpeg || isPng) {
            fs.writeFileSync(filePath, buf);
            return {
              imageUrl: `/api/v1/media/files/images/${filename}`,
              location: fallback.location,
              providerUsed: "pollinations_flux",
            };
          }
        }
      } catch (err) {
        console.warn("[image-engine] Pollinations FLUX failed, using curated real photo:", err);
      }
    }
  }

  // 2. Live OpenAI-Compatible Image Generation (OpenAI gpt-image-1, xAI grok-2-image, Together/Flux)
  if (cfg.imageProvider === "openai_compatible" && cfg.imageApiKey && cfg.imageBaseUrl) {
    const filename = `${persona.id}-oai-${hash}.png`;
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      return {
        imageUrl: `/api/v1/media/files/images/${filename}`,
        location: fallback.location,
        providerUsed: "openai_image",
      };
    }
    try {
      const res = await fetch(`${cfg.imageBaseUrl}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.imageApiKey}`,
        },
        body: JSON.stringify({
          model: cfg.imageModel || "grok-2-image",
          prompt: fullPrompt,
          n: 1,
          response_format: "b64_json",
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          data?: Array<{ b64_json?: string; url?: string }>;
        };
        const first = data.data?.[0];
        if (first?.b64_json) {
          fs.writeFileSync(filePath, Buffer.from(first.b64_json, "base64"));
          return {
            imageUrl: `/api/v1/media/files/images/${filename}`,
            location: fallback.location,
            providerUsed: "openai_image",
          };
        }
        if (first?.url) {
          const imgRes = await fetch(first.url, { signal: AbortSignal.timeout(15000) });
          if (imgRes.ok) {
            fs.writeFileSync(filePath, Buffer.from(await imgRes.arrayBuffer()));
            return {
              imageUrl: `/api/v1/media/files/images/${filename}`,
              location: fallback.location,
              providerUsed: "openai_image",
            };
          }
        }
      }
    } catch (err) {
      console.warn("[image-engine] OpenAI-compatible image gen failed, using curated real photo:", err);
    }
  }

  return {
    imageUrl: fallback.imageUrl,
    location: fallback.location,
    providerUsed: "curated_real_photo",
  };
}
