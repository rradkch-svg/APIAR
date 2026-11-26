import { PERSONA_SEEDS, type PersonaRow, type TimeSlot } from "../personas/metadata";
import type { UserRow } from "../db/session";
import { getMediaUnlockTier, type MediaAttachmentDraft } from "../media/tiers";
import type {
  BotNoteOutput,
  BotPostOutput,
  BotStoryOutput,
  DmEngineOutput,
  FeedCommentOutput,
  MemoryExtractorOutput,
  ProactiveDmOutput,
} from "./schemas";
import type { EdgePromptContext, MemoryPromptItem, PersonaStateContext } from "./prompts";

const GUARDED_STRANGERS = new Set([
  "cole",
  "sofia",
  "jade",
  "ezra",
  "victor",
  "maya",
  "helena",
  "camila",
]);

function pick<T>(arr: T[], seed?: number): T {
  const idx =
    seed !== undefined ? Math.abs(seed) % arr.length : Math.floor(Math.random() * arr.length);
  return arr[idx];
}

function hashText(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function applyPersonaStyle(text: string, persona: PersonaRow): string {
  let out = text.trim();
  if (persona.typing_style.lowercase) {
    out = out
      .split(" ")
      .map((w) => (w.length >= 2 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w : w.toLowerCase()))
      .join(" ");
  }
  if (persona.typing_style.emoji_rate === "none") {
    out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").trim();
  }
  return out;
}

function detectMentionedPersonas(text: string, excludeId?: string): PersonaRow[] {
  const lower = text.toLowerCase();
  const hits: PersonaRow[] = [];
  for (const p of PERSONA_SEEDS) {
    if (p.id === excludeId) continue;
    const firstName = p.display_name.split(" ")[0].toLowerCase();
    const idMatch = new RegExp(`\\b${p.id}\\b`, "i").test(lower);
    const nameMatch = new RegExp(`\\b${firstName}\\b`, "i").test(lower);
    const handleMatch = lower.includes(p.handle.toLowerCase());
    if (idMatch || nameMatch || handleMatch) {
      hits.push(p as unknown as PersonaRow);
    }
  }
  return hits;
}

function detectGossipCandidate(
  userMessage: string,
  user: UserRow,
  persona: PersonaRow
): { summary: string; juiciness: number } | null {
  const lower = userMessage.toLowerCase();
  const mentioned = detectMentionedPersonas(userMessage, persona.id);
  const secretSignals = [
    "secret",
    "don't tell",
    "dont tell",
    "between us",
    "nobody knows",
    "keep this quiet",
    "crush",
    "kissed",
    "hooked up",
    "dating",
    "situationship",
    "cheated",
    "lied",
    "tea",
    "gossip",
    "drama",
    "confess",
    "broke up",
    "jealous",
  ];

  const matchedSignals = secretSignals.filter((sig) => lower.includes(sig));
  if (matchedSignals.length === 0 && mentioned.length === 0) {
    return null;
  }

  let juiciness = 4;
  if (matchedSignals.length >= 1) juiciness += 2;
  if (matchedSignals.length >= 2) juiciness += 2;
  if (mentioned.length >= 1) juiciness += 2;
  if (
    lower.includes("secret") ||
    lower.includes("don't tell") ||
    lower.includes("dont tell") ||
    lower.includes("hooked up") ||
    lower.includes("kissed") ||
    lower.includes("crush")
  ) {
    juiciness = Math.max(juiciness, 8);
  }
  if (persona.gossip_propensity >= 0.8 && (matchedSignals.length > 0 || mentioned.length > 0)) {
    juiciness = Math.max(juiciness, 8);
  }
  juiciness = Math.min(10, juiciness);

  if (juiciness < 6) return null;

  const trimmedMsg = userMessage.trim().slice(0, 140);
  const whoStr =
    mentioned.length > 0
      ? ` (involving ${mentioned.map((m) => m.display_name.split(" ")[0]).join(", ")})`
      : "";
  return {
    summary: `${user.display_name} told ${persona.display_name.split(" ")[0]} a secret${whoStr}: "${trimmedMsg}"`,
    juiciness,
  };
}

function buildMockMediaAttachment(params: {
  persona: PersonaRow;
  userMessage: string;
  affinity: number;
  romanticTension: number;
  slot: TimeSlot;
  forceMedia?: boolean;
}): MediaAttachmentDraft | null {
  const { persona, userMessage, affinity, romanticTension, slot, forceMedia } = params;
  const tier = getMediaUnlockTier(affinity, romanticTension);
  if (tier.tierIndex === 0) return null;

  const lower = userMessage.toLowerCase();
  const askedForViewOnce =
    /\b(view once|view-once|disappear|private snap|secret pic|private pic|mirror snap)\b/i.test(
      lower
    );
  const askedForVideo = /\b(video|clip|vid|video note)\b/i.test(lower);
  const askedForVoice = /\b(voice|audio|hear you|voice note|sing|talk to me|vn)\b/i.test(lower);
  const askedForPhoto =
    /\b(photo|pic|selfie|snap|send a pic|what are you doing|wyd|where are you|fit check|show)\b/i.test(
      lower
    );

  const h = hashText(`${persona.id}:${userMessage}:${affinity}`);
  const firstName = persona.display_name.split(" ")[0];
  const shouldSend =
    forceMedia ||
    askedForViewOnce ||
    askedForVideo ||
    askedForVoice ||
    askedForPhoto ||
    h % 3 === 0;
  if (!shouldSend) return null;

  if (tier.tierIndex === 3) {
    if (askedForViewOnce) {
      return {
        type: "image",
        prompt_or_script: `Candid late-night mirror snap from ${firstName}, soft dim dorm light`,
        view_once: true,
      };
    }
    if (askedForVideo || (!askedForVoice && !askedForPhoto && h % 3 === 0)) {
      const videoPrompts: Record<string, string> = {
        maya: `Quick late-night studio pan over fresh ink sketches, soft lamp light, saying still up drawing`,
        theo: `Balcony night breeze clip overlooking campus lights, relaxed smirk saying come hang out soon`,
        bella: `Mirror fit check clip before heading out, laughing and asking for honest opinions`,
        gabe: `Dim garage practice room guitar riff clip showing off the new chorus`,
        lucas: `Late-night dual-monitor coding desk pan with mechanical keyboard click`,
        sofia: `Twilight terrace breeze glance over shoulder, calm smile`,
      };
      return {
        type: "video",
        prompt_or_script:
          videoPrompts[persona.id] ||
          `${firstName} filming a quick 5-second ${slot.replace("_", " ")} campus clip`,
        duration_sec: 5 + (h % 3),
      };
    }
    if (/\b(flirt|cute|miss you)\b/i.test(lower) && h % 2 === 0) {
      return {
        type: "image",
        prompt_or_script: `Candid late-night mirror snap from ${firstName}, soft warm lighting`,
        view_once: true,
      };
    }
  }

  if (tier.tierIndex >= 2) {
    if (askedForVoice || (!askedForPhoto && h % 2 === 0)) {
      const voiceScripts: Record<string, string> = {
        bella: `Okay wait hold on, I literally cannot type fast enough for this—tell me every single detail later, seriously.`,
        chloe: `Alright I am way too lazy to type this out, so you are getting a voice note. Honestly, you are actually pretty cool to talk to.`,
        theo: `Hey, figured it was easier to just say this out loud. Let me know when you are free on campus later, alright?`,
        maya: `Hey... sorry if my voice sounds super quiet, it is late and I am still sketching at the studio. Thanks for actually getting the vibe.`,
        leo: `Yo, just walking across the quad with an iced coffee. Whatever class is stressing you out today, you have got it handled.`,
        sofia: `Do not let this go to your head, okay? I almost never send voice notes. Just figured I would actually reply properly.`,
        nina: `Hey! Just stepping out of a student council meeting, figured a quick voice note was faster than typing while walking.`,
        gabe: `Yo check it out, just finished soundcheck with the band, my ears are still ringing a bit. How is your day looking?`,
        claire: `Hey, it is finally quiet in the cafe for five minutes. Figured I would send a quick audio instead of typing with one hand.`,
        lucas: `Yo, finally got my build to compile after two hours. Sending a voice note because my wrists are officially done typing.`,
        parker: `Okay hear me out, I could not type this theory fast enough without writing an essay, so voice note it is.`,
        jade: `Just walked out of Pilates and grabbing iced matcha. Figured I would leave a quick voice note while walking back to campus.`,
        brody: `Yo what is good! Just finished lifting at the rec center, figured I would drop a quick audio while walking back.`,
        mel: `Hey! Just taking a break from Figma so my eyes stop hurting. Hope your classes are going smoothly today.`,
      };
      return {
        type: "audio",
        prompt_or_script:
          voiceScripts[persona.id] ||
          `Hey, figured a quick voice note was way faster than typing right now. Hope your day on campus is going smoothly.`,
        duration_sec: 8 + (h % 7),
      };
    }

    if (tier.allowSelfie && (askedForPhoto || h % 2 === 1)) {
      return {
        type: "image",
        prompt_or_script: `Casual candid selfie of ${firstName} during ${slot.replace("_", " ")} on campus`,
        view_once: false,
      };
    }
  }

  const ambientByClique: Record<string, string> = {
    campus: `Iced coffee cup and open notebook on a sunny wooden quad table near the library`,
    influencers: `Iced oat matcha on a marble cafe table in soft afternoon sunlight`,
    drama: `Twilight view over the campus courtyard from the upper terrace`,
    arts: `Warm studio lamp glowing over vinyl records, sketchbook, and espresso`,
    tech: `Dual-monitor desk setup with mechanical keyboard and iced coffee`,
  };
  return {
    type: "image",
    prompt_or_script: ambientByClique[persona.clique] || ambientByClique.campus,
    view_once: false,
  };
}

export function mockDmResponse(params: {
  persona: PersonaRow;
  user: UserRow;
  state: PersonaStateContext;
  userMessage: string;
  messageType: "text" | "image" | "screenshot_alert" | "story_reply" | "note_reply" | "post_share";
  imageCaption?: string | null;
  historyLength?: number;
  retrievedMemories: MemoryPromptItem[];
  activeEmotionalHook?: { title: string; description: string } | null;
}): DmEngineOutput {
  const {
    persona,
    user,
    state,
    userMessage,
    messageType,
    imageCaption,
    historyLength = 0,
    retrievedMemories,
    activeEmotionalHook,
  } = params;
  const slang = persona.typing_style.slang[0] || "ngl";
  const slang2 = persona.typing_style.slang[1] || "fr";
  const lower = userMessage.toLowerCase().trim();
  const h = hashText(`${persona.id}:${userMessage}:${state.affinity}:${historyLength}`);
  const isStranger = state.affinity < 15;
  const isGuarded = GUARDED_STRANGERS.has(persona.id);
  const isFirstTurn = historyLength <= 1;

  // 1. Screenshot alert reaction
  if (messageType === "screenshot_alert") {
    const reactions: Record<string, string[]> = {
      bella: [
        "wait did you just screenshot our chat??",
        isStranger ? "we literally just started talking lol why" : "who are you sending that to rn 💀",
      ],
      chloe: [
        "uh did you just screenshot this?",
        isStranger ? "kinda weird for someone I barely know ngl" : "be serious, who's seeing receipts",
      ],
      theo: [
        isStranger ? "screenshotting already? bold" : "caught in 4k taking a screenshot huh",
        isStranger ? "we've barely talked lol" : "just don't leak it to bella",
      ],
      sofia: ["A screenshot?", "Interesting choice."],
      cole: ["why are you screenshotting my texts", "weird"],
      ezra: ["screenshotting the guy with the camera", "bold"],
      matty: ["WAIT SCREENSHOT CAUGHT IN 4K 📸", "bro what are you saving that for"],
    };
    const bubbles = (
      reactions[persona.id] || [
        "wait did you just screenshot our chat?",
        isStranger ? "kinda random ngl" : "what are you saving receipts for 👀",
      ]
    ).map((b) => applyPersonaStyle(b, persona));

    return {
      bubbles,
      affinity_delta: isStranger || isGuarded ? -3 : 0,
      romantic_delta: 0,
      new_mood: "suspicious",
      internal_thought: `${user.display_name} screenshotted our DM... kinda sus.`,
      react_emoji: null,
      gossip_candidate:
        !isStranger && persona.gossip_propensity >= 0.7
          ? {
              summary: `${user.display_name} screenshotted private DMs with ${persona.display_name.split(" ")[0]}`,
              juiciness: 6,
            }
          : null,
      media_attachment: null,
    };
  }

  // 2. Emotional hook comfort response (only unlocked for real friends)
  if (activeEmotionalHook) {
    const comforting =
      /\b(here|okay|ok|breathe|sorry|hug|got you|call|talk|listen|fine|proud|care|safe|nightmare|worry|pass|with you)\b/i.test(
        lower
      );
    const bubbles = comforting
      ? [
          `${slang}... thank you for actually answering me rn`,
          `i didn't expect anyone else to still be up`,
          `you genuinely just calmed my brain down so much`,
        ]
      : [`yeah idk, maybe I'm just overthinking it`, `thanks for replying anyway`];
    const nextAffinity = Math.min(100, state.affinity + (comforting ? 7 : 3));
    return {
      bubbles: bubbles.map((b) => applyPersonaStyle(b, persona)),
      affinity_delta: comforting ? 7 : 3,
      romantic_delta:
        comforting && ["theo", "maya", "sofia", "cole", "mel"].includes(persona.id) ? 4 : 1,
      new_mood: comforting ? "chill" : "annoyed",
      internal_thought: comforting
        ? `${user.display_name} actually stayed up and checked in on me. Won't forget that.`
        : `At least ${user.display_name} replied.`,
      react_emoji: comforting ? "❤️" : null,
      gossip_candidate: null,
      media_attachment: buildMockMediaAttachment({
        persona,
        userMessage,
        affinity: nextAffinity,
        romanticTension: state.romantic_tension,
        slot: user.current_slot,
        forceMedia: comforting && nextAffinity >= 50,
      }),
    };
  }

  const posHits = persona.triggers.positive.filter((t) => lower.includes(t.toLowerCase()));
  const negHits = persona.triggers.negative.filter((t) => lower.includes(t.toLowerCase()));
  const gossipCandidate = detectGossipCandidate(userMessage, user, persona);
  const flirtySignals =
    /\b(cute|hot|miss you|date|crush|kiss|flirt|beautiful|handsome|babe|baby|love you|marry)\b/i.test(
      lower
    );
  const isDryOpener =
    /^(hi+|hey+|yo+|sup|hello|hii+|wyd|what'?s up|wassup|how are you|how'?s it going|hey there|hi there)(\s+(there|what'?s up|wassup|wyd|how are you|how'?s it going|man|bro|dude))?\W*$/i.test(
      lower
    );
  const isQuestion = lower.includes("?");

  // 3. REALISTIC COLD-START STRANGER BEHAVIOR (affinity < 15)
  if (isStranger && !gossipCandidate) {
    if (messageType === "image") {
      const bubbles = isGuarded
        ? ["nice pic I guess", "do I know you from a class or something?"]
        : [
            `oh nice shot! ${imageCaption ? "cool spot" : "clean pic"}`,
            "are you new on campus this semester?",
          ];
      return {
        bubbles: bubbles.map((b) => applyPersonaStyle(b, persona)),
        affinity_delta: isGuarded ? 1 : 3,
        romantic_delta: 0,
        new_mood: "chill",
        internal_thought: `${user.display_name} sent a photo in DM. Seems normal enough so far.`,
        react_emoji: isGuarded ? null : "👍",
        gossip_candidate: null,
        media_attachment: null,
      };
    }

    if (flirtySignals) {
      const bubbles = isGuarded
        ? ["uh we literally don't know each other", "slow down a bit"]
        : ["haha okay bold opener", "we literally just met on here tho lol"];
      return {
        bubbles: bubbles.map((b) => applyPersonaStyle(b, persona)),
        affinity_delta: isGuarded ? -2 : 0,
        romantic_delta: 0,
        new_mood: isGuarded ? "annoyed" : "amused",
        internal_thought: `${user.display_name} came on way too strong right off the bat.`,
        react_emoji: null,
        gossip_candidate: null,
        media_attachment: null,
      };
    }

    if (negHits.length > 0) {
      return {
        bubbles: [
          applyPersonaStyle(
            isGuarded
              ? `yeah not really into ${negHits[0]}`
              : `oof ${negHits[0]} is honestly not my thing lol`,
            persona
          ),
        ],
        affinity_delta: -2,
        romantic_delta: 0,
        new_mood: "annoyed",
        internal_thought: `First impression wasn't great — brought up ${negHits[0]}.`,
        react_emoji: null,
        gossip_candidate: null,
        media_attachment: null,
      };
    }

    if (posHits.length > 0) {
      const bubbles = isGuarded
        ? [
            `wait you're into ${posHits[0]}? alright, fair enough`,
            isFirstTurn
              ? "didn't expect a random DM to actually have decent taste"
              : "you actually know your stuff tbh",
          ]
        : /\b(coffee|latte|matcha|espresso|cafe)\b/i.test(lower)
          ? [
              `foundry roasters just off the quad or elm st espresso if you want something quieter`,
              isFirstTurn ? "definitely worth stopping by between lectures" : "I'm there way too often tbh",
            ]
          : [
              `oh nice, you're into ${posHits[0]} too?`,
              isFirstTurn
                ? "are you new around campus? haven't seen you around yet"
                : "solid taste, most people around here sleep on that",
            ];
      return {
        bubbles: bubbles.map((b) => applyPersonaStyle(b, persona)),
        affinity_delta: isGuarded ? 4 : 5,
        romantic_delta: 0,
        new_mood: "amused",
        internal_thought: `Okay ${user.display_name} actually mentioned ${posHits[0]}. Might be chill.`,
        react_emoji: isGuarded ? null : "🔥",
        gossip_candidate: null,
        media_attachment: null,
      };
    }

    if (isDryOpener) {
      const personaGuardedOpeners: Record<string, string[]> = {
        jade: ["hi? do I know you?"],
        sofia: ["Hey. Do I know you from somewhere?"],
        helena: ["Hello. Can I help you with something?"],
        camila: ["Hey, do we have a lecture together?"],
        maya: ["hey... do we know each other?"],
        cole: ["hey. do I know you from class?"],
        victor: ["Hey — do we have a mutual or a class together?"],
        ezra: ["hey. what's up"],
      };
      const politeDry = [
        ["hey! saw you're new on Vela, welcome to campus", "what major are you in?"],
        ["hey what's up, how's your first week going so far?"],
        ["hi! settling into campus okay?"],
      ];
      const chosenBubbles = isGuarded
        ? personaGuardedOpeners[persona.id] || ["hey. do I know you?"]
        : pick(politeDry, h);
      return {
        bubbles: chosenBubbles.map((b) => applyPersonaStyle(b, persona)),
        affinity_delta: isGuarded ? 1 : 2,
        romantic_delta: 0,
        new_mood: "chill",
        internal_thought: isGuarded
          ? `Random dry opener from ${user.display_name}. Let's see what they actually want.`
          : `${user.display_name} said hi. Seem polite enough for a new student.`,
        react_emoji: null,
        gossip_candidate: null,
        media_attachment: null,
      };
    }

    // Topic-aware natural stranger replies (ZERO canned non-sequiturs!)
    let strangerContextual: string[];
    if (/\b(library|study|exam|calc|quiet|alden|building|campus tips|tips)\b/i.test(lower)) {
      strangerContextual = isGuarded
        ? ["alden 4th floor is the only quiet floor", "avoid the 2nd floor unless you like noise"]
        : [
            "alden library 4th floor is the best spot if you actually need quiet tables",
            "just get there before noon or every outlet is taken lol",
          ];
    } else if (/\b(coffee|matcha|latte|cafe|food|eat|pizza|lunch)\b/i.test(lower)) {
      strangerContextual = isGuarded
        ? ["elm st espresso is decent if you skip the quad line"]
        : ["foundry roasters for coffee, oat & bloom if you like matcha", "way better than the dining hall stuff"];
    } else if (/\b(post|feed|pic|photo|story|saw your)\b/i.test(lower)) {
      strangerContextual = isGuarded
        ? ["oh thanks", "just snapped that earlier"]
        : [
            "aww thanks! glad it popped up on your feed",
            isFirstTurn ? "are you new on campus this semester?" : "the light around campus was too good today",
          ];
    } else if (/\b(major|studying|class|classes|lecture)\b/i.test(lower)) {
      strangerContextual = isGuarded
        ? ["depends who's asking tbh", isFirstTurn ? "you just transfer here or what?" : "kept pretty busy this semester"]
        : [
            "mostly drowning in lecture readings right now tbh",
            isFirstTurn ? "what classes are you taking this semester?" : "hope your schedule isn't as chaotic as mine",
          ];
    } else {
      strangerContextual = isGuarded
        ? [
            isQuestion ? "depends who's asking tbh" : "fair enough",
            isFirstTurn ? "you just transfer here or what?" : "anyway, got class in a bit",
          ]
        : [
            messageType === "story_reply"
              ? "haha thanks! just snapped that between classes"
              : messageType === "note_reply"
                ? "lol glad someone else gets it"
                : isQuestion
                  ? "honestly yeah, campus gets pretty busy around here"
                  : "haha true, campus always has something going on",
            isFirstTurn ? "how are you liking it here so far?" : "hope your week is going smoothly so far",
          ];
    }

    return {
      bubbles: strangerContextual.map((b) => applyPersonaStyle(b, persona)),
      affinity_delta: isGuarded ? 2 : 4,
      romantic_delta: 0,
      new_mood: "chill",
      internal_thought: `${user.display_name} seems pretty normal to talk to so far.`,
      react_emoji: null,
      gossip_candidate: null,
      media_attachment: null,
    };
  }

  // 4. ACQUAINTANCE / FRIEND / CLOSE DM (affinity >= 15 OR juicy gossip)
  let affinityDelta = isDryOpener ? 1 : 3;
  let romanticDelta = 0;
  let newMood: DmEngineOutput["new_mood"] = "chill";
  let reactEmoji: string | null = null;

  if (posHits.length > 0) {
    affinityDelta += 3;
    newMood = "hyped";
    reactEmoji = "🔥";
  }
  if (negHits.length > 0) {
    affinityDelta -= 4;
    newMood = "annoyed";
  }
  if (flirtySignals) {
    if (state.affinity >= 25) {
      romanticDelta += ["theo", "maya", "sofia", "cole", "gabe", "bella", "mel"].includes(
        persona.id
      )
        ? 5
        : 3;
      affinityDelta += 2;
      newMood = "flirty";
      reactEmoji = "👀";
    } else {
      romanticDelta += 1;
      newMood = "amused";
    }
  }
  if (gossipCandidate) {
    affinityDelta += persona.gossip_propensity >= 0.7 ? 4 : 2;
    newMood = persona.gossip_propensity >= 0.7 ? "hyped" : "suspicious";
    reactEmoji = "👀";
  }

  affinityDelta = Math.max(-10, Math.min(8, affinityDelta));
  romanticDelta = Math.max(-5, Math.min(6, romanticDelta));

  const bubbles: string[] = [];
  const leakedMemory = retrievedMemories.find((m) => m.source_type === "gossip");
  const regularMemory = retrievedMemories.find((m) => m.source_type !== "gossip");

  if (gossipCandidate) {
    if (persona.gossip_propensity >= 0.8) {
      bubbles.push(
        `wait hold on ${slang}!!`,
        `are you actually serious right now??`,
        `okay my lips are sealed I promise... mostly 🤭`,
        `do NOT leave anything out, tell me the rest`
      );
    } else {
      bubbles.push(
        `wait hold on, ${slang} are you serious?`,
        `that's actually wild... I'm not saying anything, don't worry`,
        `just be careful who else hears about that around campus`
      );
    }
  } else if (messageType === "image") {
    bubbles.push(
      `${slang} wait that's actually such a good shot`,
      imageCaption
        ? `love the vibe in that photo fr, where on campus was this?`
        : `where are you right now? looks super chill`
    );
    reactEmoji = "❤️";
  } else if (messageType === "post_share") {
    bubbles.push(
      `lmaooo wait I just saw that post too`,
      `people on campus Vela have zero filter today ${slang}`
    );
    reactEmoji = "😂";
  } else if (leakedMemory && h % 2 === 0) {
    const leaker = leakedMemory.leaked_by_persona || "someone";
    bubbles.push(
      `wait before we even get into that...`,
      `${leaker} mentioned something interesting earlier 👀`,
      `care to explain your side of it or nah?`
    );
    newMood = persona.id === "sofia" ? "jealous" : "amused";
  } else if (flirtySignals && state.affinity >= 25) {
    bubbles.push(
      `${slang}, bold thing to text me like that`,
      `not complaining tho, keep that energy up`,
      `what are you even up to right now?`
    );
  } else if (negHits.length > 0) {
    bubbles.push(
      `${slang2}... please don't even get me started on ${negHits[0]}`,
      `instant headache just thinking about it`
    );
  } else if (posHits.length > 0) {
    bubbles.push(
      `WAIT you're into ${posHits[0]} too?? ${slang}`,
      `okay sudden respect boost`,
      regularMemory
        ? `honestly you're way cooler than I expected when you first got here`
        : `we should actually talk about that more later`
    );
  } else if (messageType === "story_reply") {
    bubbles.push(
      `haha appreciate it ${slang}`,
      `had to capture the vibe before heading to my next class`
    );
    reactEmoji = "❤️";
  } else if (messageType === "note_reply") {
    bubbles.push(`glad somebody else on here actually reads notes lol`, `how's your day going?`);
  } else {
    const naturalPools = [
      [
        `${slang} honestly valid`,
        regularMemory
          ? `still remember you mentioning that earlier too`
          : `campus has been way too loud today anyway`,
      ],
      [
        `wait that actually makes sense ${slang}`,
        `my schedule has been all over the place this ${user.current_slot.replace("_", " ")}`,
      ],
      [
        `haha fair enough`,
        isQuestion
          ? `honestly just trying to survive classes and grab coffee tbh`
          : `what else have you been up to around campus?`,
      ],
    ];
    bubbles.push(...pick(naturalPools, h));
  }

  const targetCount = Math.max(1, Math.min(4, persona.typing_style.avg_bubbles || 2));
  const finalBubbles = bubbles
    .slice(0, Math.max(targetCount, gossipCandidate ? 3 : 2))
    .map((b) => applyPersonaStyle(b, persona));

  const projectedAffinity = Math.max(0, Math.min(100, state.affinity + affinityDelta));
  const projectedRomance = Math.max(0, Math.min(100, state.romantic_tension + romanticDelta));

  const internalThought = gossipCandidate
    ? persona.gossip_propensity >= 0.7
      ? `Whoa, this tea from ${user.display_name} is wild. Hard not to share this.`
      : `${user.display_name} just told me something pretty big. Keeping it noted.`
    : flirtySignals && state.affinity >= 25
      ? `Wait is ${user.display_name} actually flirting with me rn? Lowkey working.`
      : posHits.length > 0
        ? `We actually vibe over ${posHits[0]}. Definitely warming up to them.`
        : negHits.length > 0
          ? `Why did they bring up ${negHits[0]}... slightly annoyed.`
          : `Good chat with ${user.display_name}. Actually starting to like having them around.`;

  const mediaAttachment = buildMockMediaAttachment({
    persona,
    userMessage,
    affinity: projectedAffinity,
    romanticTension: projectedRomance,
    slot: user.current_slot,
  });

  return {
    bubbles: finalBubbles,
    affinity_delta: affinityDelta,
    romantic_delta: romanticDelta,
    new_mood: newMood,
    internal_thought: internalThought.slice(0, 160),
    react_emoji: reactEmoji,
    gossip_candidate: gossipCandidate,
    media_attachment: mediaAttachment,
  };
}

export function mockFeedComment(params: {
  persona: PersonaRow;
  user: UserRow;
  postBody: string;
  isUserPost?: boolean;
  state?: PersonaStateContext | null;
  parentComment?: { body: string; authorName: string } | null;
  edge?: EdgePromptContext | null;
  extraContext?: string | null;
}): FeedCommentOutput {
  const { persona, postBody, isUserPost = true, state, parentComment, edge, extraContext } = params;
  const slang = persona.typing_style.slang[0] || "fr";
  const lower = postBody.toLowerCase();
  const isStrangerToUser = isUserPost && (state?.affinity ?? 0) < 15;

  if (extraContext && /flaked|declined|jealous/i.test(extraContext)) {
    const shadePool = [
      `oh cool so THIS is what you had time for instead?? ${slang}`,
      `funny how plans suddenly opened up huh 🙃`,
      `lol okay noted`,
    ];
    return {
      comment: applyPersonaStyle(
        pick(shadePool, hashText(persona.id + postBody)),
        persona
      ).slice(0, 180),
      likes_post: false,
      affinity_delta: -2,
    };
  }

  // Reply to a user's comment on a post!
  if (parentComment && !edge) {
    const replyPool = isStrangerToUser
      ? [
          `haha right? appreciate it`,
          `yeah honestly campus life in a nutshell`,
          `true, glad someone else gets it`,
        ]
      : [
          `lmaooo ${slang} you already know`,
          `haha wait stop you're too right`,
          `finally someone gets the vision ${slang}`,
        ];
    return {
      comment: applyPersonaStyle(
        pick(replyPool, hashText(persona.id + parentComment.body)),
        persona
      ).slice(0, 180),
      likes_post: true,
      affinity_delta: isStrangerToUser ? 2 : 3,
    };
  }

  // Bot-to-bot threaded reply based on directed edge friction/affinity!
  if (parentComment && edge) {
    const targetFirst = parentComment.authorName.split(" ")[0];
    if (edge.friction > 0.65 || edge.relation_type === "rival" || edge.relation_type === "ex") {
      const fightLines: Record<string, string> = {
        chloe: `${targetFirst} literally nobody asked for your commentary here, ${slang} sit down`,
        jade: `aww ${targetFirst}, it's so brave of you to comment without reading the room first`,
        sofia: `Interesting how ${targetFirst} always shows up in every comment section.`,
        theo: `here we go again ${targetFirst}... can we have one normal thread pls`,
        camila: `${targetFirst} that's textbook strawman logic and you know it`,
        cole: `${targetFirst} always trying too hard in public, ${slang}`,
        bella: `${targetFirst} acting unbothered is hilarious rn 💀`,
        lauren: `Love how loud people get in comments ☕`,
        ezra: `bold talk ${targetFirst}, considering what's on my SD card from Friday`,
        matty: `OH WE GOT BEEF IN THE COMMENTS 🍿 LMAOOO`,
      };
      const fallbackFight = `${targetFirst} ${slang} why do you always make everything weird on the feed??`;
      return {
        comment: applyPersonaStyle(fightLines[persona.id] || fallbackFight, persona).slice(0, 180),
        likes_post: false,
        affinity_delta: 0,
      };
    } else {
      const allyLines = [
        `${targetFirst} literally read my mind ${slang}`,
        `backing ${targetFirst} up 100% on this one`,
        `realest take in the comments ${targetFirst}`,
      ];
      return {
        comment: applyPersonaStyle(
          pick(allyLines, hashText(persona.id + targetFirst)),
          persona
        ).slice(0, 180),
        likes_post: true,
        affinity_delta: 1,
      };
    }
  }

  // Top-level comment on a stranger's post (realistic casual campus politeness!)
  if (isStrangerToUser) {
    const politeStrangerComments = [
      `clean shot, welcome to campus!`,
      `nice vibe, which building is that near?`,
      `solid pic ${slang}`,
      `cool aesthetic, welcome to Vela`,
      `nice lighting on this one`,
    ];
    return {
      comment: applyPersonaStyle(
        pick(politeStrangerComments, hashText(persona.id + postBody)),
        persona
      ).slice(0, 180),
      likes_post: true,
      affinity_delta: 2,
    };
  }

  const posHit = persona.triggers.positive.find((t) => lower.includes(t.toLowerCase()));
  const negHit = persona.triggers.negative.find((t) => lower.includes(t.toLowerCase()));

  let rawComment: string;
  let likes = true;
  let delta = 2;

  if (negHit) {
    rawComment = `${slang} not you posting about ${negHit} on my timeline today`;
    likes = false;
    delta = -1;
  } else if (posHit) {
    rawComment = `${slang} finally someone on campus with taste!! ${posHit} supremacy`;
    likes = true;
    delta = 3;
  } else {
    const personaLines: Record<string, string> = {
      chloe: `ok this actually goes pretty hard ${slang}`,
      leo: `Love the vibe of this shot, hope your day's going smooth!`,
      theo: `lowkey best photo on my feed today`,
      nina: `Cute shot, hope you're surviving the week!`,
      brody: `bro this vibe goes crazy 🔥`,
      bella: `wait this lighting is actually so good ✨`,
      jade: `clean aesthetic tbh`,
      ezra: `solid frame. good light`,
      lauren: `Such a vibe! Made my scroll better ☕`,
      matty: `LMAOOO actually iconic`,
      cole: `not bad at all`,
      sofia: `Nice shot.`,
      victor: `Strong energy right here 📈`,
      camila: `Actually love this angle.`,
      maya: `lowkey love the mood in this one`,
      gabe: `feels like an indie album cover fr`,
      claire: `good atmosphere. stop by elm st espresso sometime`,
      trey: `clean vibe chief 🎧`,
      lucas: `real. clean shot`,
      helena: `Surprisingly solid composition.`,
      parker: `major main-character lighting on this one`,
      mel: `omg wait the colors in this are so clean!!`,
    };
    rawComment = personaLines[persona.id] || `${slang} love this shot`;
  }

  return {
    comment: applyPersonaStyle(rawComment, persona).slice(0, 180),
    likes_post: likes,
    affinity_delta: delta,
  };
}

export function mockExtractMemories(params: {
  recentMessages: string[];
  existingMemories: string[];
}): MemoryExtractorOutput {
  const existingLower = new Set(params.existingMemories.map((e) => e.toLowerCase()));
  const newFacts: MemoryExtractorOutput["new_facts"] = [];

  for (const msg of params.recentMessages) {
    const cleaned = msg.trim();
    if (cleaned.length < 12) continue;

    const patterns: Array<{
      regex: RegExp;
      category: MemoryExtractorOutput["new_facts"][number]["category"];
      importance: number;
    }> = [
      {
        regex: /\b(secret|don't tell|dont tell|nobody knows|hooked up|kissed|crush on)\b/i,
        category: "secret",
        importance: 9,
      },
      { regex: /\b(dog|cat|puppy|kitten|pet)\b/i, category: "pet", importance: 6 },
      {
        regex: /\b(love|hate|favorite|obsessed with|into|coffee|matcha|music|movie|game|band)\b/i,
        category: "taste",
        importance: 5,
      },
      {
        regex: /\b(major|studying|exam|calc|class|job|internship|work)\b/i,
        category: "study_work",
        importance: 6,
      },
      {
        regex: /\b(promise|swear|deal|i'll be there|count me in)\b/i,
        category: "promise",
        importance: 7,
      },
      { regex: /\b(drama|fight|jealous|mad at|flaked|ex)\b/i, category: "drama", importance: 8 },
      {
        regex: /\b(dorm|live in|from |campus|apartment|cafe|library)\b/i,
        category: "location",
        importance: 5,
      },
    ];

    for (const pat of patterns) {
      if (pat.regex.test(cleaned)) {
        const fact = `User shared: "${cleaned.slice(0, 130)}"`;
        if (!existingLower.has(fact.toLowerCase())) {
          existingLower.add(fact.toLowerCase());
          newFacts.push({ fact, category: pat.category, importance: pat.importance });
        }
        break;
      }
    }
  }

  return { new_facts: newFacts.slice(0, 3) };
}

export function mockBotPost(params: {
  persona: PersonaRow;
  user: UserRow;
  contextHint?: string;
}): BotPostOutput {
  const { persona, user, contextHint } = params;
  if (contextHint && contextHint.includes("HANGOUT_RECAP:")) {
    const title = contextHint.replace("HANGOUT_RECAP:", "").trim();
    const body = applyPersonaStyle(
      `just wrapped ${title} with ${user.handle} — actually such a good time fr`,
      persona
    );
    return {
      body: body.slice(0, 260),
      image_prompt: `Candid campus hangout moment for ${title}, warm lighting`,
      location_tag: "Main Quad",
      mood: "hyped",
    };
  }

  const slotPosts: Record<
    string,
    Array<{ body: string; image_prompt: string; location_tag: string }>
  > = {
    chloe: [
      {
        body: "if anyone sees me crying over calc II in the library mind your business fr",
        image_prompt: "Iced coffee and calculus notebook on wooden study table in library",
        location_tag: "Alden Library · 4F",
      },
      {
        body: "iced latte keeping my last two braincells employed today",
        image_prompt: "Iced latte coffee cup on sunny campus cafe quad table",
        location_tag: "West Quad Café",
      },
    ],
    bella: [
      {
        body: "golden hour walk across north campus + iced oat matcha ✨",
        image_prompt: "Iced oat matcha cup on sunlit cafe table aesthetic golden light",
        location_tag: "Oat & Bloom Matcha",
      },
      {
        body: "deleting this later maybe but campus walks hit different before sunset",
        image_prompt: "Autumn golden hour campus walkway sunlight trees",
        location_tag: "North Campus Walk",
      },
    ],
    theo: [
      {
        body: "campus hits different right after sunset",
        image_prompt: "Sunset rooftop view over college town skyline golden dusk",
        location_tag: "West Terrace Rooftop",
      },
      {
        body: "late balcony air before calling it a night",
        image_prompt: "Quiet night balcony view overlooking glowing evening lights",
        location_tag: "South Hall Balcony",
      },
    ],
    maya: [
      {
        body: "3am flash sheet coming together. sleep is overrated anyway",
        image_prompt: "Art sketchbook tattoo ink pen drawing under warm studio lamp",
        location_tag: "Arts Annex Studio",
      },
      {
        body: "rainy window + vinyl night in the studio",
        image_prompt: "Rainy cafe window moody evening light cozy quiet",
        location_tag: "Arts Annex Studio",
      },
    ],
    matty: [
      {
        body: "late night slice run with the boys never misses 🍕",
        image_prompt: "Late night pizza slices hangout table friends campus",
        location_tag: "Sal's Late Night Slice",
      },
      {
        body: "house lights already on for Friday, campus isn't ready",
        image_prompt: "Backyard string lights evening house hangout party crowd",
        location_tag: "Cedar St. House",
      },
    ],
    victor: [
      {
        body: "early gym session + pre-market scan done before 8am.",
        image_prompt: "Evening gym weights workout training clean minimalist",
        location_tag: "Campus Rec Center",
      },
      {
        body: "city dusk after seminar. stay focused.",
        image_prompt: "City skyline dusk evening overlook clean photography",
        location_tag: "Downtown Overlook",
      },
    ],
    sofia: [
      {
        body: "quiet terrace sunset before evening reading.",
        image_prompt: "Sunset rooftop terrace golden light calm aesthetic",
        location_tag: "West Terrace Rooftop",
      },
    ],
    gabe: [
      {
        body: "band practice ran late and the new chorus actually hits rn 🎸",
        image_prompt: "Electric guitar amplifier garage practice room studio warm lights",
        location_tag: "Garage Practice Room",
      },
      {
        body: "crate digging at spin & ink instead of doing my essay",
        image_prompt: "Vinyl records crates indie record shop warm aesthetic",
        location_tag: "Spin & Ink Records",
      },
    ],
    lucas: [
      {
        body: "2am bug fix finally compiled. sleep schedule officially deprecated",
        image_prompt: "Dual monitor coding setup dark desk mechanical keyboard night",
        location_tag: "CS Lab · 2AM",
      },
      {
        body: "ranked queue warmed up, who's running duos",
        image_prompt: "PC gaming desk setup monitor headset evening dorm",
        location_tag: "North Dorm 4B",
      },
    ],
    parker: [
      {
        body: "prepping Saturday's campaign board, this plot twist is gonna wreck the party 🎲",
        image_prompt: "D&D polyhedral dice notebooks wooden table rec room",
        location_tag: "Rec Room Table 2",
      },
    ],
    jade: [
      {
        body: "morning pilates + oat matcha. keeping peace intact.",
        image_prompt: "Bright minimalist pilates reformer studio morning sunlight",
        location_tag: "Form Pilates Studio",
      },
    ],
    leo: [
      {
        body: "morning pour-over before 9am lecture. good luck on midterms y'all",
        image_prompt: "Pour over coffee brewing calm cafe morning sunlight",
        location_tag: "Foundry Roasters",
      },
    ],
    nina: [
      {
        body: "fourth floor library stacks are undefeated when you actually need to lock in",
        image_prompt: "University library stacks wooden study tables books quiet",
        location_tag: "Alden Library · 4F",
      },
    ],
    claire: [
      {
        body: "double espresso + rainy street outside elm st",
        image_prompt: "Espresso bar cafe barista quiet indie coffee shop",
        location_tag: "Elm St. Espresso",
      },
      {
        body: "re-watching an old 35mm favorite at the bijou tonight",
        image_prompt: "Indie art house movie cinema theater warm glow",
        location_tag: "Bijou Indie Cinema",
      },
    ],
    ezra: [
      {
        body: "35mm roll from last night's walk down college ave",
        image_prompt: "35mm film camera street night photography candid flash",
        location_tag: "College Ave",
      },
    ],
    lauren: [
      {
        body: "quiet afternoon stop at chapter one before class ☕",
        image_prompt: "Indie bookstore wooden shelves cozy afternoon light",
        location_tag: "Chapter One Books",
      },
    ],
    trey: [
      {
        body: "testing a new transition for Friday's basement set 🎧",
        image_prompt: "DJ decks club booth night lighting electronic music",
        location_tag: "The Basement Lounge",
      },
    ],
    mel: [
      {
        body: "redesigning my portfolio grid for the fourth time today lol",
        image_prompt: "iPad design desk workspace stylus notebook aesthetic",
        location_tag: "Design Studio",
      },
    ],
    helena: [
      {
        body: "three hours of clean data in the lab today. rare win.",
        image_prompt: "University science research lab clean modern bench",
        location_tag: "Benson Research Lab",
      },
    ],
    brody: [
      {
        body: "quad sun finally came out today, whole crew out on the lawn",
        image_prompt: "Sunny college campus quad students green grass afternoon",
        location_tag: "Main Quad",
      },
    ],
    cole: [
      {
        body: "late session at the rec center. clearing my head.",
        image_prompt: "Gym evening workout equipment moody lighting",
        location_tag: "Campus Rec Center",
      },
    ],
    camila: [
      {
        body: "prepping mock trial cross-examination notes with way too much caffeine",
        image_prompt: "Law study notes highlighters open books library desk",
        location_tag: "Commons Study Hall",
      },
    ],
  };

  const pool = slotPosts[persona.id] || [
    {
      body: `quiet ${user.current_slot.replace("_", " ")} around campus`,
      image_prompt: `Candid campus ${user.current_slot.replace("_", " ")} coffee walk`,
      location_tag: "Main Quad",
    },
  ];
  const chosen = pick(pool, hashText(persona.id + user.current_day + Date.now()));
  return {
    body: applyPersonaStyle(chosen.body, persona),
    image_prompt: chosen.image_prompt,
    location_tag: chosen.location_tag,
    mood: "chill",
  };
}

export function mockBotStory(params: { persona: PersonaRow; user: UserRow }): BotStoryOutput {
  const storyMap: Record<string, { caption: string; image_prompt: string; location_tag: string }> = {
    chloe: { caption: "coffee #2 before 11am send help", image_prompt: "iced coffee quad campus table", location_tag: "West Quad Café" },
    leo: { caption: "quick walk across the quad before studio", image_prompt: "sunny college quad green lawn walk", location_tag: "Main Quad" },
    theo: { caption: "dusk light over south hall", image_prompt: "golden dusk campus skyline terrace", location_tag: "West Terrace Rooftop" },
    brody: { caption: "post-lift refuel with the crew", image_prompt: "late night pizza slices hangout table", location_tag: "Sal's Late Night Slice" },
    nina: { caption: "student union planning session", image_prompt: "study notes planner highlighters desk", location_tag: "Student Union" },
    bella: { caption: "afternoon matcha run ✨", image_prompt: "iced oat matcha marble table aesthetic", location_tag: "Oat & Bloom Matcha" },
    jade: { caption: "reformer pilates done for the day", image_prompt: "bright pilates studio morning light", location_tag: "Form Pilates Studio" },
    ezra: { caption: "35mm test frames from college ave", image_prompt: "film camera street night flash candid", location_tag: "College Ave" },
    lauren: { caption: "found three books I didn't need ☕", image_prompt: "cozy indie bookstore wooden shelves", location_tag: "Chapter One Books" },
    matty: { caption: "cedar st lights already up for tonight", image_prompt: "backyard string lights college evening", location_tag: "Cedar St. House" },
    sofia: { caption: "quiet evening view.", image_prompt: "twilight balcony skyline calm", location_tag: "South Hall Balcony" },
    cole: { caption: "evening lift done.", image_prompt: "moody gym weights training evening", location_tag: "Campus Rec Center" },
    victor: { caption: "late seminar wrap.", image_prompt: "city dusk skyline overlook evening", location_tag: "Downtown Overlook" },
    camila: { caption: "case briefs + way too much espresso", image_prompt: "university library books stacks desk", location_tag: "Alden Library · 4F" },
    maya: { caption: "rainy window + new ink sketches", image_prompt: "rainy cafe window moody quiet night", location_tag: "Arts Annex Studio" },
    gabe: { caption: "digging through vinyl between classes 🎸", image_prompt: "vinyl records crates indie record shop", location_tag: "Spin & Ink Records" },
    claire: { caption: "quiet shift at elm st", image_prompt: "espresso bar indie cafe barista", location_tag: "Elm St. Espresso" },
    trey: { caption: "soundcheck for friday's set 🎧", image_prompt: "dj booth club decks night lighting", location_tag: "The Basement Lounge" },
    lucas: { caption: "queued up after lab finally finished", image_prompt: "pc gaming desk monitor headset dorm", location_tag: "North Dorm 4B" },
    parker: { caption: "campaign notes looking unhinged rn 🎲", image_prompt: "dnd dice table notebooks rec room", location_tag: "Rec Room Table 2" },
    helena: { caption: "clean run in benson lab today", image_prompt: "modern science research lab bench", location_tag: "Benson Research Lab" },
    mel: { caption: "sketching layouts on the ipad", image_prompt: "ipad design desk stylus aesthetic", location_tag: "Design Studio" },
  };
  const chosen = storyMap[params.persona.id];
  if (chosen) {
    return {
      caption: applyPersonaStyle(chosen.caption, params.persona),
      image_prompt: chosen.image_prompt,
      location_tag: chosen.location_tag,
    };
  }
  const post = mockBotPost({ persona: params.persona, user: params.user });
  return {
    caption: post.body.slice(0, 85),
    image_prompt: post.image_prompt || `Candid campus photo by ${params.persona.display_name}`,
    location_tag: post.location_tag || "Main Quad",
  };
}

export function mockBotNote(params: { persona: PersonaRow; user: UserRow }): BotNoteOutput {
  const noteMap: Record<string, string[]> = {
    chloe: ["calc II is personally attacking me", "need iced coffee immediately"],
    leo: ["pour-over at foundry rn", "anyone studying on the quad?"],
    theo: ["west terrace sunset hits rn", "listening to frank ocean on loop"],
    brody: ["quad pickup game at 5", "who's grabbing sal's pizza later"],
    nina: ["alden 4F locked in 📚", "student union mixer this week!"],
    bella: ["new matcha spot is 10/10 ✨", "golden hour walk soon"],
    jade: ["pilates done, do not perceive me", "iced oat matcha supremacy"],
    ezra: ["developing a fresh 35mm roll", "college ave at dusk"],
    lauren: ["book recommendations pls ☕", "cozy afternoon at chapter one"],
    matty: ["who's free for pizza tonight", "surviving on vibes alone"],
    sofia: ["quiet night, finally.", "don't kill my vibe today"],
    cole: ["rec center till 9", "headphones in, world off"],
    victor: ["market open > sleeping in", "espresso #3"],
    camila: ["mock trial prep till midnight", "debate me on anything"],
    maya: ["3am studio playlist recs?", "sketching new flash tonight"],
    gabe: ["band rehearsal tonight 🎸", "vinyl hunting after class"],
    claire: ["elm st espresso is quiet rn", "watching an A24 double feature"],
    trey: ["friday setlist coming together 🎧", "new mix dropping soon"],
    lucas: ["why does it compile only at 2am", "duo queue anyone?"],
    parker: ["d&d prep chaos 🎲", "new theory dropping soon"],
    helena: ["lab results finally converged", "coffee before seminar"],
    mel: ["figma auto-layout broke my soul", "design studio till 7"],
  };
  const pool = noteMap[params.persona.id] || ["surviving classes today", "campus coffee run"];
  return {
    body: applyPersonaStyle(pick(pool, hashText(params.persona.id + params.user.current_day)), params.persona).slice(
      0,
      60
    ),
  };
}

export function mockProactiveDm(params: {
  persona: PersonaRow;
  user: UserRow;
  state: PersonaStateContext;
  reason: string;
  memories: MemoryPromptItem[];
  allowMedia?: boolean;
}): ProactiveDmOutput {
  const { persona, user, state, reason, memories, allowMedia } = params;
  const slang = persona.typing_style.slang[0] || "ngl";
  const h = hashText(`${persona.id}:${user.current_day}:${user.current_slot}`);
  let bubbles: string[];
  let newMood: ProactiveDmOutput["new_mood"] = "chill";
  let thought = `Decided to check in with ${user.display_name}.`;

  if (/gossip|confront|leaked/i.test(reason)) {
    const gossipMem = memories.find((m) => m.source_type === "gossip");
    const leaker = gossipMem?.leaked_by_persona || "someone";
    bubbles =
      persona.id === "sofia"
        ? [
            `So ${leaker} just mentioned something interesting to me.`,
            `Want to tell me your side before everyone starts talking?`,
          ]
        : [
            `wait ${slang}... ${leaker} just told me something wild 👀`,
            `is that actually true?!`,
          ];
    newMood = persona.id === "sofia" ? "jealous" : "hyped";
    thought = `Heard campus gossip from ${leaker}. Had to ask ${user.display_name} directly.`;
  } else if (/orientation|campus/i.test(reason) && persona.id === "nina") {
    bubbles = [
      `Hey ${user.display_name}, saw you just joined campus Vela — welcome!`,
      `I'm on student council, so lmk if you need help finding any buildings or orgs this week.`,
    ];
    newMood = "chill";
    thought = `Sent a quick polite student-council welcome to the new student.`;
  } else {
    // NEVER echo the raw `reason` string! Generate natural casual check-ins based on time slot.
    const slotCheckins: Record<TimeSlot, string[][]> = {
      morning: [
        [`yo ${user.display_name}, did you survive your morning class?`, `already on coffee #2 ${slang}`],
        [`morning! campus is weirdly sunny today`, `what's your schedule looking like?`],
      ],
      afternoon: [
        [`hey, random check-in`, `the quad is packed right now, what are you up to?`],
        [`just got out of lecture and my brain is fried ${slang}`, `how's your afternoon going?`],
      ],
      evening: [
        [`hey, sunset on campus looked crazy today`, `any plans tonight or just chilling?`],
        [`finally done with classes for the day ${slang}`, `what's the move this evening?`],
      ],
      late_night: [
        [`still up?`, `can't sleep at all tonight ${slang}`],
        [`late night check-in — still surviving the semester?`],
      ],
    };
    bubbles = pick(slotCheckins[user.current_slot] || slotCheckins.afternoon, h);
  }

  const mediaAttachment =
    allowMedia !== false && state.affinity >= 25
      ? buildMockMediaAttachment({
          persona,
          userMessage: bubbles.join(" "),
          affinity: state.affinity,
          romanticTension: state.romantic_tension,
          slot: user.current_slot,
          forceMedia: /media|photo|voice/i.test(reason),
        })
      : null;

  return {
    bubbles: bubbles.map((b) => applyPersonaStyle(b, persona)),
    new_mood: newMood,
    internal_thought: thought.slice(0, 160),
    media_attachment: mediaAttachment,
  };
}

export function mockImageCaption(imageUrl: string, postBody: string): string {
  if (imageUrl.startsWith("data:image/") || imageUrl.startsWith("/api/v1/media/files/")) {
    return postBody
      ? `A candid college photo shared with the caption "${postBody.slice(0, 70)}"`
      : "A candid smartphone photo from around campus";
  }
  return `A candid photo shared on Vela ("${postBody.slice(0, 60)}")`;
}
