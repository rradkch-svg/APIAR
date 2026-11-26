import { NextResponse } from "next/server";
import { PERSONA_SEED_MAP, type PersonaRow } from "@/lib/personas/metadata";
import { pickRealisticFallbackPhoto } from "@/lib/media/image-engine";

/**
 * Legacy compatibility redirect: redirects any historical /api/v1/media/mock-scene URLs
 * straight to a real photorealistic local JPG (zero SVG scenes anywhere in Vela!).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const personaId = searchParams.get("persona") || "bella";
  const kind = (searchParams.get("kind") || "ambient") as
    | "ambient"
    | "selfie"
    | "view_once"
    | "video";
  const prompt = searchParams.get("prompt") || "campus photo";
  const persona = (PERSONA_SEED_MAP[personaId] || PERSONA_SEED_MAP.bella) as unknown as PersonaRow;
  const picked = pickRealisticFallbackPhoto({ persona, prompt, sceneKind: kind });

  return NextResponse.redirect(new URL(picked.imageUrl, req.url), 302);
}
