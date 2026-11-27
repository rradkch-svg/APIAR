import type { PersonaRow } from "@/lib/personas/metadata";

export const STATIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function withBasePath(url: string | null | undefined): string | null {
  if (!url) return null;
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  ) {
    return url;
  }
  if (STATIC_BASE_PATH && url.startsWith(`${STATIC_BASE_PATH}/`)) {
    return url;
  }
  if (url.startsWith("/")) {
    return `${STATIC_BASE_PATH}${url}`;
  }
  return url;
}

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

export function pickStaticCampusPhoto(params: {
  persona: PersonaRow;
  prompt: string;
  sceneKind?: "post" | "ambient" | "selfie" | "view_once" | "video" | "story";
  excludeUrls?: string[];
}): { imageUrl: string; location: string } {
  const { persona, prompt, sceneKind, excludeUrls = [] } = params;
  const excludeSet = new Set(excludeUrls);

  if ((sceneKind === "selfie" || sceneKind === "view_once") && persona.avatar_url) {
    return {
      imageUrl: withBasePath(persona.avatar_url) || persona.avatar_url,
      location: "Campus",
    };
  }

  const lower = `${prompt} ${persona.id} ${persona.bio} ${persona.clique}`.toLowerCase();
  const candidates = CURATED_CAMPUS_PHOTOS.filter(
    (e) => !excludeSet.has(e.file) && !excludeSet.has(withBasePath(e.file) || "")
  );
  const pool = candidates.length > 0 ? candidates : CURATED_CAMPUS_PHOTOS;

  const scored = pool
    .map((entry) => {
      let score = 0;
      for (const tag of entry.tags) {
        if (lower.includes(tag)) score += 4;
      }
      if (entry.cliques.includes(persona.clique)) score += 1.5;
      let h = 0;
      const key = `${entry.file}:${prompt.slice(0, 50)}`;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
      score += (Math.abs(h) % 100) / 100;
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = scored[0]?.entry || CURATED_CAMPUS_PHOTOS[0];
  return {
    imageUrl: withBasePath(chosen.file) || chosen.file,
    location: chosen.location,
  };
}
