export type MediaType = "image" | "audio" | "video";

export interface MediaAttachmentDraft {
  type: MediaType;
  prompt_or_script: string;
  duration_sec?: number;
  view_once?: boolean;
}

export interface MediaUnlockStage {
  tierIndex: 0 | 1 | 2 | 3;
  id: "text_only" | "casual_photos" | "voice_and_selfies" | "video_and_view_once";
  label: string;
  shortLabel: string;
  requirement: string;
  unlocked: boolean;
}

export interface MediaTierInfo {
  tierIndex: 0 | 1 | 2 | 3;
  tierId: "text_only" | "casual_photos" | "voice_and_selfies" | "video_and_view_once";
  label: string;
  allowedTypes: MediaType[];
  allowSelfie: boolean;
  allowViewOnce: boolean;
  promptPolicy: string;
  nextUnlockHint: string | null;
  progressPercent: number;
  stages: MediaUnlockStage[];
}

export function getMediaUnlockTier(
  affinity: number,
  romanticTension: number
): MediaTierInfo {
  const isTier3 = affinity >= 75 || romanticTension >= 50;
  const isTier2 = !isTier3 && affinity >= 50;
  const isTier1 = !isTier3 && !isTier2 && affinity >= 25;

  const tierIndex: 0 | 1 | 2 | 3 = isTier3 ? 3 : isTier2 ? 2 : isTier1 ? 1 : 0;

  const stages: MediaUnlockStage[] = [
    {
      tierIndex: 0,
      id: "text_only",
      label: "Text Only",
      shortLabel: "Text",
      requirement: "Start",
      unlocked: true,
    },
    {
      tierIndex: 1,
      id: "casual_photos",
      label: "Casual Photos",
      shortLabel: "Photos",
      requirement: "Affinity 25+",
      unlocked: tierIndex >= 1,
    },
    {
      tierIndex: 2,
      id: "voice_and_selfies",
      label: "Voice Notes & Selfies",
      shortLabel: "Voice",
      requirement: "Affinity 50+",
      unlocked: tierIndex >= 2,
    },
    {
      tierIndex: 3,
      id: "video_and_view_once",
      label: "Videos & View-Once",
      shortLabel: "Videos",
      requirement: "Affinity 75+ or Tension 50+",
      unlocked: tierIndex >= 3,
    },
  ];

  if (tierIndex === 0) {
    const needed = Math.max(1, 25 - affinity);
    return {
      tierIndex: 0,
      tierId: "text_only",
      label: "Text Only",
      allowedTypes: [],
      allowSelfie: false,
      allowViewOnce: false,
      promptPolicy:
        "TIER 0 (Text Only — affinity < 25): You MUST set media_attachment to null. Do NOT send photos, voice notes, or videos yet.",
      nextUnlockHint: `+${needed} affinity to unlock Casual Photos`,
      progressPercent: Math.round((Math.max(0, affinity) / 75) * 100),
      stages,
    };
  }

  if (tierIndex === 1) {
    const needed = Math.max(1, 50 - affinity);
    return {
      tierIndex: 1,
      tierId: "casual_photos",
      label: "Casual Photos",
      allowedTypes: ["image"],
      allowSelfie: false,
      allowViewOnce: false,
      promptPolicy:
        "TIER 1 (Casual Photos — affinity 25-49): You may occasionally attach type='image' showing ONLY casual environment/ambient scenes (coffee cup, campus quad, desk setup, library, venue — NO selfies, NO face/intimate shots, view_once MUST be false). Do NOT send audio or video.",
      nextUnlockHint: `+${needed} affinity to unlock Voice Notes & Selfies`,
      progressPercent: Math.round((affinity / 75) * 100),
      stages,
    };
  }

  if (tierIndex === 2) {
    const affNeeded = Math.max(1, 75 - affinity);
    const romNeeded = Math.max(1, 50 - romanticTension);
    return {
      tierIndex: 2,
      tierId: "voice_and_selfies",
      label: "Voice Notes & Selfies",
      allowedTypes: ["image", "audio"],
      allowSelfie: true,
      allowViewOnce: false,
      promptPolicy:
        "TIER 2 (Voice Notes & Selfies — affinity 50-74): You may attach type='audio' (short natural spoken voice note, duration_sec 6-25, prompt_or_script = exact spoken transcript) OR type='image' (casual ambient photo OR casual candid selfie; view_once MUST be false). Do NOT send video.",
      nextUnlockHint: `+${affNeeded} affinity (or +${romNeeded} tension) to unlock Videos & View-Once`,
      progressPercent: Math.round((affinity / 75) * 100),
      stages,
    };
  }

  return {
    tierIndex: 3,
    tierId: "video_and_view_once",
    label: "Videos & View-Once",
    allowedTypes: ["image", "audio", "video"],
    allowSelfie: true,
    allowViewOnce: true,
    promptPolicy:
      "TIER 3 (Videos & View-Once — affinity >= 75 or romantic_tension >= 50): Full media unlocked! You may attach type='video' (short 3-8s vertical/circular video note), type='image' (including view_once: true for candid/flirty/private snaps), or type='audio' (personal/late-night voice note, 6-25s).",
    nextUnlockHint: null,
    progressPercent: 100,
    stages,
  };
}

/**
 * Hard server-side security/progression gate executed in router.ts.
 * If the LLM attempts to attach media above the user's unlocked tier,
 * it is strictly blocked/discarded.
 */
export function enforceMediaAttachmentPolicy(
  attachment: MediaAttachmentDraft | null | undefined,
  affinity: number,
  romanticTension: number
): {
  attachment: MediaAttachmentDraft | null;
  blockedReason: string | null;
  tier: MediaTierInfo;
} {
  const tier = getMediaUnlockTier(affinity, romanticTension);
  if (!attachment) {
    return { attachment: null, blockedReason: null, tier };
  }

  if (!tier.allowedTypes.includes(attachment.type)) {
    return {
      attachment: null,
      blockedReason: `Blocked '${attachment.type}' attachment: current proximity tier is '${tier.tierId}' (affinity=${affinity}, romantic_tension=${romanticTension}).`,
      tier,
    };
  }

  const sanitized: MediaAttachmentDraft = {
    type: attachment.type,
    prompt_or_script: attachment.prompt_or_script.trim().slice(0, 400),
  };

  if (attachment.type === "image") {
    if (attachment.view_once && !tier.allowViewOnce) {
      // Block view_once below Tier 3
      return {
        attachment: null,
        blockedReason: `Blocked 'view_once' photo: requires Tier 3 (affinity >= 75 or romantic_tension >= 50).`,
        tier,
      };
    }
    sanitized.view_once = Boolean(attachment.view_once && tier.allowViewOnce);
  } else if (attachment.type === "audio") {
    const raw = Number(attachment.duration_sec ?? 11);
    sanitized.duration_sec = Math.max(6, Math.min(25, Math.round(Number.isFinite(raw) ? raw : 11)));
  } else if (attachment.type === "video") {
    const raw = Number(attachment.duration_sec ?? 5);
    sanitized.duration_sec = Math.max(3, Math.min(8, Math.round(Number.isFinite(raw) ? raw : 5)));
  }

  return { attachment: sanitized, blockedReason: null, tier };
}
