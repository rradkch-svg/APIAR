import seedPersonasJson from "../../../db/seed_personas_en.json";

export type TimeSlot = "morning" | "afternoon" | "evening" | "late_night";

export const TIME_SLOTS: TimeSlot[] = ["morning", "afternoon", "evening", "late_night"];

export const TIME_SLOT_META: Record<
  TimeSlot,
  { label: string; shortLabel: string; timeRange: string; emoji: string; ambientMood: string }
> = {
  morning: {
    label: "Morning",
    shortLabel: "AM",
    timeRange: "8:00 AM – 12:00 PM",
    emoji: "☀️",
    ambientMood: "iced coffee, 9am lectures, sunny campus quad",
  },
  afternoon: {
    label: "Afternoon",
    shortLabel: "PM",
    timeRange: "12:00 PM – 6:00 PM",
    emoji: "🌤️",
    ambientMood: "campus café tables, study sessions, quad hangouts",
  },
  evening: {
    label: "Evening",
    shortLabel: "EVE",
    timeRange: "6:00 PM – 11:00 PM",
    emoji: "🌆",
    ambientMood: "golden hour rooftops, band rehearsals, house parties",
  },
  late_night: {
    label: "Late Night",
    shortLabel: "3AM",
    timeRange: "11:00 PM – 4:00 AM",
    emoji: "🌙",
    ambientMood: "3am overthinking, dim dorm LEDs, confessions & nightmares",
  },
};

export interface TypingStyle {
  lowercase: boolean;
  emoji_rate: "none" | "low" | "medium" | "high";
  avg_bubbles: number;
  slang: string[];
  delay_sec_range: [number, number];
}

export interface VoiceProfile {
  tone: string;
  rate: number;
  pitch: number;
  accent: string;
  gender: "male" | "female";
  tts_voice_id: string;
  style_notes: string;
}

export interface ActivitySchedule {
  peak_hours: [number, number];
  active_slots: TimeSlot[];
}

export interface PersonaSeed {
  id: string;
  display_name: string;
  handle: string;
  clique: "campus" | "influencers" | "drama" | "arts" | "tech";
  archetype: string;
  avatar_url: string;
  accent_color: string;
  age: number;
  bio: string;
  personality_prompt: string;
  typing_style: TypingStyle;
  voice_profile: VoiceProfile;
  visual_anchor: string;
  secrets: string[];
  triggers: {
    positive: string[];
    negative: string[];
  };
  gossip_propensity: number;
  activity_schedule: ActivitySchedule;
  initial_thoughts: {
    low: string;
    mid: string;
    high: string;
  };
}

export interface PersonaRow {
  id: string;
  display_name: string;
  handle: string;
  clique: string;
  archetype: string;
  avatar_url: string | null;
  accent_color: string;
  age: number;
  bio: string;
  personality_prompt: string;
  typing_style: TypingStyle;
  voice_profile: VoiceProfile;
  visual_anchor: string;
  secrets: string[];
  triggers: { positive: string[]; negative: string[] };
  gossip_propensity: number;
  activity_schedule: ActivitySchedule;
  is_active: boolean;
}

export const PERSONA_SEEDS: PersonaSeed[] = seedPersonasJson as PersonaSeed[];

export const PERSONA_SEED_MAP: Record<string, PersonaSeed> = Object.fromEntries(
  PERSONA_SEEDS.map((p) => [p.id, p])
);

export const CLIQUE_META: Record<
  string,
  { label: string; color: string; tagline: string }
> = {
  campus: {
    label: "Campus Core",
    color: "#3B82F6",
    tagline: "Your day-one squad, study chaos & unspoken tension",
  },
  influencers: {
    label: "Influencers",
    color: "#EC4899",
    tagline: "Clout, matcha runs, secret finstas & 95% gossip leak rates",
  },
  drama: {
    label: "Drama",
    color: "#F59E0B",
    tagline: "Rivals, territorial exes, finance bros & courtroom energy",
  },
  arts: {
    label: "Arts & Afterhours",
    color: "#A855F7",
    tagline: "3am ink studios, indie bands, espresso & DJ sets",
  },
  tech: {
    label: "Tech & Lab",
    color: "#22C55E",
    tagline: "2am ranked queues, D&D theories, Figma & spreadsheets",
  },
};

const COLD_START_STRANGER_THOUGHTS: Record<string, string> = {
  chloe: "New handle just showed up in campus Explore. No idea who they are yet.",
  leo: "Looks like a new student just joined Vela. Seems chill, haven't met them yet.",
  theo: "New face on the campus feed. Haven't crossed paths yet.",
  brody: "New student on Vela? Probably a transfer or freshman.",
  nina: "Saw a new campus account pop up — I should check if they're in any of the orgs.",
  bella: "Wait who's this new account? Barely any posts yet, keeping an eye out.",
  jade: "Random new profile on campus Explore. Not following unless I actually know them.",
  ezra: "Another new student account. Let's see if they actually have taste.",
  lauren: "New profile on Vela! Always nice seeing new faces around campus.",
  matty: "Who's the new kid on campus Vela lol",
  sofia: "Don't know them. Zero mutuals.",
  cole: "Random new account. Whatever.",
  victor: "New student on campus. No mutual connections yet.",
  camila: "New profile on campus Vela — haven't seen them in lecture yet.",
  maya: "Saw a new account on Explore. Don't know their vibe yet.",
  gabe: "New person on campus Vela, wonder if they listen to indie rock.",
  claire: "New face on the campus feed. Quiet profile so far.",
  trey: "New student on campus. Don't know them yet.",
  lucas: "Some new account popped up on campus Vela.",
  parker: "New student! Wonder if they play anything or join any campus clubs.",
  helena: "New account in the campus directory. Zero interaction data.",
  mel: "Oh a new student joined Vela! Seems low-key so far.",
};

export function getInitialThought(personaId: string, affinity: number): string {
  if (affinity < 15) {
    return (
      COLD_START_STRANGER_THOUGHTS[personaId] ||
      "New student on campus Vela. Don't know them yet."
    );
  }
  const seed = PERSONA_SEED_MAP[personaId];
  if (!seed) return "Still getting a read on them.";
  if (affinity >= 65) return seed.initial_thoughts.high;
  if (affinity >= 38) return seed.initial_thoughts.mid;
  return seed.initial_thoughts.low;
}

export function isPersonaOnline(
  schedule: ActivitySchedule | Record<string, unknown> | null | undefined,
  currentSlot: TimeSlot = "afternoon"
): boolean {
  if (!schedule || typeof schedule !== "object") return true;
  const slots = (schedule as ActivitySchedule).active_slots;
  if (Array.isArray(slots) && slots.length > 0) {
    return slots.includes(currentSlot);
  }
  return true;
}

export function advanceTimeSlot(
  currentDay: number,
  currentSlot: TimeSlot
): { day: number; slot: TimeSlot } {
  const idx = TIME_SLOTS.indexOf(currentSlot);
  if (idx < 0 || idx === TIME_SLOTS.length - 1) {
    return { day: currentDay + 1, slot: "morning" };
  }
  return { day: currentDay, slot: TIME_SLOTS[idx + 1] };
}

export function compareLogicalTime(
  aDay: number,
  aSlot: TimeSlot,
  bDay: number,
  bSlot: TimeSlot
): number {
  if (aDay !== bDay) return aDay - bDay;
  return TIME_SLOTS.indexOf(aSlot) - TIME_SLOTS.indexOf(bSlot);
}

export function computeRelationshipStage(
  affinity: number,
  romanticTension: number,
  isRival = false
): "stranger" | "acquaintance" | "friend" | "close" | "crush" | "rival" {
  if (isRival && affinity < 20) return "rival";
  if (romanticTension >= 50 && affinity >= 45) return "crush";
  if (affinity >= 75) return "close";
  if (affinity >= 40) return "friend";
  if (affinity >= 15) return "acquaintance";
  return "stranger";
}

function hashStr(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Generates a stylized, crisp, dark-first portrait SVG avatar unique to each persona
 * using their accent_color, clique motif, hairstyle/accessory silhouette, and initials.
 */
export function buildPersonaAvatarSvg(persona: PersonaSeed): string {
  const h = hashStr(persona.id);
  const accent = persona.accent_color;
  const initials = persona.display_name
    .replace(/'[^']*'/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || "")
    .join("");

  const skinTones = ["#F3C6A5", "#E5B08B", "#C98D67", "#F6D4BA", "#8D5A3C", "#DBA37E"];
  const hairTones = ["#181421", "#2D1E1B", "#4B3228", "#121218", "#5C3D2E", "#231B2E"];
  const skin =
    persona.id === "trey"
      ? "#7D4E34"
      : persona.id === "sofia" || persona.id === "camila"
        ? "#CFA07E"
        : persona.id === "nina" ||
            persona.id === "maya" ||
            persona.id === "lucas" ||
            persona.id === "parker" ||
            persona.id === "mel"
          ? "#F1CBB0"
          : skinTones[h % skinTones.length];
  const hair = hairTones[(h >> 3) % hairTones.length];
  const isFem = persona.voice_profile.gender === "female";

  const cliqueGlow =
    persona.clique === "influencers"
      ? "#F472B6"
      : persona.clique === "arts"
        ? "#C084FC"
        : persona.clique === "tech"
          ? "#34D399"
          : persona.clique === "drama"
            ? "#FBBF24"
            : "#60A5FA";

  const hairBack = isFem
    ? `<path d="M28 62 C26 30, 44 18, 64 18 C84 18, 102 30, 100 62 L104 102 C92 98, 86 96, 82 96 L46 96 C42 96, 36 98, 24 102 Z" fill="${hair}"/>`
    : `<path d="M35 55 C35 28, 48 20, 64 20 C80 20, 93 28, 93 55 C90 42, 80 34, 64 34 C48 34, 38 42, 35 55 Z" fill="${hair}"/>`;

  const hairFront = isFem
    ? `<path d="M36 52 C38 30, 52 24, 64 25 C78 24, 90 32, 92 52 C84 40, 74 35, 64 36 C54 35, 44 40, 36 52 Z" fill="${hair}"/>`
    : `<path d="M37 49 C40 27, 54 22, 66 23 C79 23, 90 31, 91 49 C82 37, 71 34, 58 36 C49 37, 42 42, 37 49 Z" fill="${hair}"/>`;

  const accessory =
    persona.id === "nina" || persona.id === "helena"
      ? `<g stroke="#E2E8F0" stroke-width="2" fill="none" opacity="0.9">
           <rect x="44" y="54" width="16" height="11" rx="4"/>
           <rect x="68" y="54" width="16" height="11" rx="4"/>
           <line x1="60" y1="59" x2="68" y2="59"/>
         </g>`
      : persona.id === "trey" || persona.id === "lucas"
        ? `<g stroke="${accent}" stroke-width="4" fill="none">
             <path d="M33 62 C32 34, 46 20, 64 20 C82 20, 96 34, 95 62" stroke-opacity="0.85"/>
             <rect x="28" y="55" width="9" height="18" rx="4" fill="#1E1B2E" stroke="${accent}" stroke-width="2"/>
             <rect x="91" y="55" width="9" height="18" rx="4" fill="#1E1B2E" stroke="${accent}" stroke-width="2"/>
           </g>`
        : persona.id === "maya"
          ? `<path d="M36 46 C38 24, 52 18, 64 18 C76 18, 90 24, 92 46 Z" fill="#1F1A2E" stroke="${accent}" stroke-width="1.5"/>`
          : persona.id === "sofia" || persona.id === "bella"
            ? `<g stroke="#FBBF24" stroke-width="2" fill="none">
                 <circle cx="38" cy="70" r="5"/>
                 <circle cx="90" cy="70" r="5"/>
               </g>`
            : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <radialGradient id="bg-${persona.id}" cx="30%" cy="22%" r="85%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.52"/>
      <stop offset="55%" stop-color="#191628"/>
      <stop offset="100%" stop-color="#0B0A10"/>
    </radialGradient>
    <linearGradient id="shirt-${persona.id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${accent}"/>
      <stop offset="100%" stop-color="#1D1A2F"/>
    </linearGradient>
    <clipPath id="clip-${persona.id}">
      <circle cx="64" cy="64" r="62"/>
    </clipPath>
  </defs>
  <g clip-path="url(#clip-${persona.id})">
    <rect width="128" height="128" fill="url(#bg-${persona.id})"/>
    <circle cx="104" cy="24" r="24" fill="${cliqueGlow}" fill-opacity="0.16"/>
    <circle cx="20" cy="108" r="28" fill="${accent}" fill-opacity="0.14"/>
    ${hairBack}
    <path d="M20 128 C24 98, 42 89, 64 89 C86 89, 104 98, 108 128 Z" fill="url(#shirt-${persona.id})"/>
    <rect x="55" y="75" width="18" height="18" rx="8" fill="${skin}"/>
    <ellipse cx="64" cy="58" rx="24" ry="27" fill="${skin}"/>
    <circle cx="53" cy="59" r="2.7" fill="#14111D"/>
    <circle cx="75" cy="59" r="2.7" fill="#14111D"/>
    <circle cx="54" cy="58" r="0.9" fill="#FFFFFF"/>
    <circle cx="76" cy="58" r="0.9" fill="#FFFFFF"/>
    <path d="M56 71 Q64 76 72 71" stroke="#3B2420" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    ${hairFront}
    ${accessory}
    <rect x="82" y="96" width="32" height="18" rx="9" fill="#0B0A10" fill-opacity="0.72" stroke="${accent}" stroke-opacity="0.7" stroke-width="1"/>
    <text x="98" y="109" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="700" fill="#F8FAFC">${initials}</text>
  </g>
</svg>`;
}
