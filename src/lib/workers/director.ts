import crypto from "crypto";
import { dbQuery, dbQueryOne } from "../db/client";
import type { UserRow } from "../db/session";
import {
  advanceTimeSlot,
  compareLogicalTime,
  TIME_SLOT_META,
  type PersonaRow,
  type TimeSlot,
} from "../personas/metadata";
import { emitRealtimeEvent } from "../realtime/bus";
import { generateProactiveDm } from "../llm/router";
import { retrieveTopMemories } from "../llm/embeddings";
import { enforceMediaAttachmentPolicy } from "../media/tiers";
import { propagateGossip } from "../graph/gossip";
import { applyUserPersonaStateUpdate, deliverPersonaTurnBubbles, type PersistedDmRow } from "./deliver";
import { createAutonomousBotPost } from "./lazy-feed";

export interface WorldEventRow {
  id: string;
  user_id: string;
  persona_id: string;
  event_type: "spontaneous_ping" | "emotional_hook" | "invite";
  title: string;
  description: string;
  scheduled_day: number;
  scheduled_slot: TimeSlot;
  status: "pending" | "accepted" | "declined" | "flaked" | "completed" | "expired";
  reward_affinity: number;
  penalty_affinity: number;
  conflict_group: string | null;
  dm_message_id: string | null;
  created_at: string;
}

interface InviteTemplate {
  personaId: string;
  minAffinity: number;
  title: string;
  description: string;
  preferredSlots: TimeSlot[];
  inviteLine: string;
  aftermathLine: string;
  photoPrompt: string;
}

const CAMPUS_INVITE_CATALOG: InviteTemplate[] = [
  // Open / Public Campus Events (minAffinity 18 — plausible for an acquaintance to invite a new student)
  {
    personaId: "nina",
    minAffinity: 18,
    title: "Student Union New-Student Mixer",
    description: "Nina is hosting an open campus org mixer at the Student Union — good way to meet people.",
    preferredSlots: ["afternoon", "evening"],
    inviteLine: "hey! student council is hosting a chill new-student mixer at the union — swing by if you're free",
    aftermathLine: "glad you stopped by the mixer! definitely made things less awkward than last semester's",
    photoPrompt: "Sunny college student union lounge with coffee cups and students chatting casually",
  },
  {
    personaId: "brody",
    minAffinity: 20,
    title: "Open Quad Hangout & Grill",
    description: "Brody is firing up the grill and rallying half the dorms.",
    preferredSlots: ["afternoon", "evening"],
    inviteLine: "yo we're setting up the grill on cedar st with a bunch of people from campus — feel free to swing by",
    aftermathLine: "glad you pulled up!! solid afternoon fr",
    photoPrompt: "College backyard hangout with string lights, casual campus crowd, warm evening",
  },
  {
    personaId: "parker",
    minAffinity: 22,
    title: "Open Rec Room Board-Game Night",
    description: "Parker has an open chair for a casual campaign / board-game table at the Rec Room.",
    preferredSlots: ["evening", "late_night"],
    inviteLine: "hey we have an extra spot open for board-game night in the rec room if you're looking for something to do",
    aftermathLine: "NAT 20 session fr!! you lowkey carried the entire table",
    photoPrompt: "Rec room table with polyhedral dice, character sheets, and snacks in warm evening light",
  },
  {
    personaId: "trey",
    minAffinity: 24,
    title: "Friday Basement DJ Warmup",
    description: "Trey is spinning an open campus basement set.",
    preferredSlots: ["evening", "late_night"],
    inviteLine: "yo spinning a campus warmup set at the basement lounge — pull up if you're out tonight 🎧",
    aftermathLine: "crowd went crazy tonight, appreciate you swinging through 🔥",
    photoPrompt: "Moody college basement DJ booth with Pioneer decks and warm crowd lights",
  },
  // Friend Hangouts (minAffinity 38 — requires actual friendship first)
  {
    personaId: "chloe",
    minAffinity: 38,
    title: "Emergency Iced Coffee & People-Watching",
    description: "Chloe needs caffeine and someone normal to roast campus life with on the quad.",
    preferredSlots: ["morning", "afternoon"],
    inviteLine: "sos i need an iced coffee and someone normal to sit on the quad with, u free?",
    aftermathLine: "okay that coffee run actually restored 40% of my will to survive calc II ngl",
    photoPrompt: "Two iced coffees on a sunny wooden campus quad bench with messy notebooks",
  },
  {
    personaId: "leo",
    minAffinity: 38,
    title: "Acoustic Coffeehouse Study Break",
    description: "Leo wants to grab pour-over coffee and test out two new acoustic songs.",
    preferredSlots: ["afternoon", "evening"],
    inviteLine: "hey, heading to foundry roasters with my guitar — wanna grab a pour-over and chill?",
    aftermathLine: "seriously appreciate you hanging out today, felt like the first calm hour all week ☕",
    photoPrompt: "Warm indie coffeehouse corner with pour-over carafe and acoustic guitar",
  },
  {
    personaId: "gabe",
    minAffinity: 40,
    title: "Garage Indie Band Rehearsal",
    description: "Gabe wants you at his band's rehearsal to rate their new chorus.",
    preferredSlots: ["evening", "late_night"],
    inviteLine: "yo our band is rehearsing our new set — pull up and tell me if the chorus actually works 🎸",
    aftermathLine: "bro you coming to rehearsal literally saved the whole bridge. appreciate the honest notes",
    photoPrompt: "Dim garage practice room with electric guitar, vintage amp, and handwritten setlist",
  },
  {
    personaId: "lucas",
    minAffinity: 40,
    title: "Late-Night Ranked Duo Queue",
    description: "Lucas needs a reliable duo partner who won't throw his elo.",
    preferredSlots: ["evening", "late_night"],
    inviteLine: "random teammates are throwing my elo rn. hop on duo queue with me?",
    aftermathLine: "gg!! 4-game win streak — officially never solo-queuing again",
    photoPrompt: "Dual-monitor gaming desk setup at night with mechanical keyboard and headset",
  },
  {
    personaId: "mel",
    minAffinity: 40,
    title: "Café Figma Co-Working & Iced Lattes",
    description: "Mel wants a cozy study/design buddy at the quiet café.",
    preferredSlots: ["morning", "afternoon"],
    inviteLine: "grabbing a table at the café to finish my design deck — wanna co-work + iced lattes?",
    aftermathLine: "omg we actually got SO much done today!! let's do this again soon",
    photoPrompt: "Wooden café table with iPad Pro, iced vanilla latte, and afternoon sunlight",
  },
  // Close / Personal Invites (minAffinity 58 — NEVER sent to strangers or casual acquaintances!)
  {
    personaId: "bella",
    minAffinity: 58,
    title: "Golden-Hour Content Shoot & Tea Debrief",
    description: "Bella wants a trusted friend for a campus photo walk and real gossip.",
    preferredSlots: ["afternoon", "evening"],
    inviteLine: "okay come with me for golden-hour pics + iced matcha, I have INSANE campus tea to actually tell u ✨",
    aftermathLine: "STOP those photos turned out so good and talking to you is literally therapy!!",
    photoPrompt: "Warm golden-hour walkway on campus with iced matcha cup and sunset sunlight",
  },
  {
    personaId: "jade",
    minAffinity: 58,
    title: "Pilates & Iced Matcha Run",
    description: "Jade invited you to her boutique pilates studio followed by oat matcha.",
    preferredSlots: ["morning", "afternoon"],
    inviteLine: "i have an extra reformer pass for pilates + oat matcha after. come with? 🩰",
    aftermathLine: "okay wait you actually kept up in pilates AND passed the matcha test. approved ✨",
    photoPrompt: "Sunlit minimalist café marble table with two iced oat matchas after pilates",
  },
  {
    personaId: "theo",
    minAffinity: 58,
    title: "Sunset Balcony Hangout",
    description: "Theo asked if you want to skip the noisy crowd and catch sunset from the terrace.",
    preferredSlots: ["evening", "late_night"],
    inviteLine: "skip the loud crowd tonight? grabbing coffee and heading up to the west terrace balcony",
    aftermathLine: "ngl that might be the best evening i've had all semester. don't get smug about it tho",
    photoPrompt: "Blue-hour campus terrace view at sunset with two takeaway coffee cups on stone ledge",
  },
  {
    personaId: "maya",
    minAffinity: 60,
    title: "Midnight Flash-Sheet Ink Session",
    description: "Maya invited you into her studio while she sketches new tattoo flash.",
    preferredSlots: ["evening", "late_night"],
    inviteLine: "putting indie vinyl on in the studio while i draw flash tonight. wanna hang in quiet chaos?",
    aftermathLine: "haven't felt that comfortable sharing my sketchbook space with anyone in a long time. thank u",
    photoPrompt: "Dim studio desk at night with black ink pens, tattoo flash sketchbook, and warm lamp",
  },
  {
    personaId: "claire",
    minAffinity: 58,
    title: "Indie A24 Double Feature",
    description: "Claire reserved two seats at the tiny off-campus cinema near her café.",
    preferredSlots: ["evening", "late_night"],
    inviteLine: "bijou cinema is screening an indie double feature. got a spare ticket if you want quiet company",
    aftermathLine: "solid film, even better post-movie breakdown. logging that one 4.5 stars",
    photoPrompt: "Vintage indie cinema marquee glowing in evening dusk light",
  },
];

interface EmotionalHookTemplate {
  personaId: string;
  title: string;
  description: string;
  preferredSlots: TimeSlot[];
  bubbles: string[];
  ignoredReply: string;
}

const EMOTIONAL_HOOK_CATALOG: EmotionalHookTemplate[] = [
  {
    personaId: "maya",
    title: "3AM Nightmare Spiral",
    description: "Maya woke up shaken from a vivid nightmare at 3am and reached out because she trusts you.",
    preferredSlots: ["late_night"],
    bubbles: [
      "hey... are you still awake?",
      "just woke up from the worst nightmare and my heart won't slow down",
      "idk why i texted you first, just didn't wanna sit in the dark alone rn",
    ],
    ignoredReply: "nvm, sorry for texting you at 3am. i'll just put headphones on",
  },
  {
    personaId: "chloe",
    title: "Calc II Panic Attack",
    description: "Chloe is staring at her Calculus II practice exam convinced she's going to fail out.",
    preferredSlots: ["late_night", "evening"],
    bubbles: [
      "okay don't laugh at me pls",
      "i've been staring at this calc II review for 3 hours and literally nothing makes sense",
      "genuinely terrified i'm gonna fail this class and ruin my scholarship fr",
    ],
    ignoredReply: "ok cool never mind, pretending I never sent that meltdown",
  },
  {
    personaId: "mel",
    title: "Overthinking Lucas at Midnight",
    description: "Mel is spiraling after Lucas gave her a super oblivious reply and needs reassurance.",
    preferredSlots: ["late_night", "evening"],
    bubbles: [
      "omg wait can I vent for literally two seconds",
      "i stayed up helping lucas debug his UI and he literally called me 'bro' and walked out 😭",
      "am i just delusional for still liking him after 8 months??",
    ],
    ignoredReply: "haha sorry for dumping my drama on you, forget i said anything",
  },
  {
    personaId: "cole",
    title: "Rare Imposter-Syndrome Crack",
    description: "Cole dropped his tough-guy armor late at night after feeling like a fraud on campus.",
    preferredSlots: ["late_night"],
    bubbles: [
      "don't screenshot this or tell anyone",
      "sometimes i feel like everyone on this campus is about to realize i'm faking all the confidence",
      "idk why i'm even telling you this rn",
    ],
    ignoredReply: "whatever, forget it. shouldn't have said anything anyway",
  },
  {
    personaId: "theo",
    title: "Late-Night Overthinking",
    description: "Theo ran into Sofia near the quad and is spiraling about past mistakes.",
    preferredSlots: ["late_night", "evening"],
    bubbles: [
      "hey you up?",
      "ran into sofia outside the library earlier and it kinda wrecked my headspace",
      "ngl talking to you is the only thing that makes this campus feel normal lately",
    ],
    ignoredReply: "all good, you're probably asleep. catch you tomorrow",
  },
];

async function insertWorldEventMessage(params: {
  userId: string;
  persona: PersonaRow;
  event: WorldEventRow;
  inviteLine: string;
}): Promise<PersistedDmRow | null> {
  const row = await dbQueryOne<PersistedDmRow>(
    `INSERT INTO dm_messages (
      user_id, persona_id, sender_type, message_type, body, media_url, media_metadata, bubble_group_id
    ) VALUES ($1, $2, 'persona', 'event_invite', $3, NULL, $4::jsonb, $5)
    RETURNING *`,
    [
      params.userId,
      params.persona.id,
      params.inviteLine,
      JSON.stringify({
        world_event_id: params.event.id,
        title: params.event.title,
        description: params.event.description,
        scheduled_day: params.event.scheduled_day,
        scheduled_slot: params.event.scheduled_slot,
        reward_affinity: params.event.reward_affinity,
        penalty_affinity: params.event.penalty_affinity,
        conflict_group: params.event.conflict_group,
        status: params.event.status,
      }),
      crypto.randomUUID(),
    ]
  );

  if (row) {
    await dbQuery("UPDATE world_events SET dm_message_id = $2 WHERE id = $1", [
      params.event.id,
      row.id,
    ]);
    await dbQuery(
      `UPDATE user_persona_state
       SET unread_count = unread_count + 1, last_interaction_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND persona_id = $2`,
      [params.userId, params.persona.id]
    );
    emitRealtimeEvent(params.userId, "dm:bubble", {
      persona_id: params.persona.id,
      message: row,
    });
    emitRealtimeEvent(params.userId, "notification:push", {
      title: `Invite from ${params.persona.display_name}`,
      body: `${params.event.title} · Day ${params.event.scheduled_day} (${TIME_SLOT_META[params.event.scheduled_slot].label})`,
      route: `/dms/${params.persona.id}`,
      accent_color: params.persona.accent_color,
      persona_id: params.persona.id,
    });
  }

  return row;
}

/**
 * Resolves events that reached or passed the new (currentDay, currentSlot):
 * - Accepted invites at/before current slot -> completed (+affinity, post-hangout DM/photo, feed post, jealous flaked comment!)
 * - Pending emotional hooks from previous slots -> expired with hurt reaction
 * - Pending invites whose slot passed -> expired
 */
export async function resolveWorldEventsForSlot(
  user: UserRow,
  targetDay: number,
  targetSlot: TimeSlot
): Promise<{ completedInvites: string[]; expiredEvents: string[] }> {
  const completedInvites: string[] = [];
  const expiredEvents: string[] = [];

  const openEvents = await dbQuery<WorldEventRow>(
    `SELECT * FROM world_events
     WHERE user_id = $1 AND status IN ('pending', 'accepted')
     ORDER BY scheduled_day ASC, created_at ASC`,
    [user.id]
  );

  for (const ev of openEvents.rows) {
    const cmp = compareLogicalTime(ev.scheduled_day, ev.scheduled_slot, targetDay, targetSlot);
    const persona = await dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [
      ev.persona_id,
    ]);
    if (!persona) continue;

    // 1. Accepted invite reached its scheduled slot -> COMPLETE IT!
    if (ev.event_type === "invite" && ev.status === "accepted" && cmp <= 0) {
      await dbQuery("UPDATE world_events SET status = 'completed' WHERE id = $1", [ev.id]);
      if (ev.dm_message_id) {
        await dbQuery(
          `UPDATE dm_messages
           SET media_metadata = jsonb_set(media_metadata, '{status}', '"completed"'::jsonb)
           WHERE id = $1`,
          [ev.dm_message_id]
        );
      }

      const stateUpdate = await applyUserPersonaStateUpdate(user.id, persona.id, {
        affinityDelta: ev.reward_affinity,
        trustDelta: 6,
        romanticDelta: ["theo", "maya", "sofia", "cole", "mel", "gabe"].includes(persona.id) ? 4 : 1,
        newMood: "hyped",
        internalThought: `Had the best time at "${ev.title}" with ${user.display_name}!`,
        incrementUnread: true,
      });

      const template = CAMPUS_INVITE_CATALOG.find((t) => t.personaId === persona.id);
      const photoDraft =
        stateUpdate.affinity >= 25
          ? enforceMediaAttachmentPolicy(
              {
                type: "image",
                prompt_or_script:
                  template?.photoPrompt ||
                  `Candid hangout snapshot from ${ev.title} on campus with ${persona.display_name}`,
                view_once: false,
              },
              stateUpdate.affinity,
              stateUpdate.romantic_tension
            ).attachment
          : null;

      await deliverPersonaTurnBubbles({
        userId: user.id,
        persona,
        bubbles: [
          template?.aftermathLine ||
            `ngl "${ev.title}" was SO much fun with you!! already planning round 2`,
        ],
        mediaAttachment: photoDraft,
        stateUpdate,
        instant: true,
        pushNotification: true,
      });

      // Find any persona who got flaked or declined on this exact slot/conflict_group!
      const spurned = await dbQueryOne<{ persona_id: string; status: string }>(
        `SELECT persona_id, status FROM world_events
         WHERE user_id = $1
           AND id <> $2
           AND event_type = 'invite'
           AND status IN ('flaked', 'declined')
           AND ((scheduled_day = $3 AND scheduled_slot = $4) OR (conflict_group IS NOT NULL AND conflict_group = $5))
         ORDER BY CASE WHEN status = 'flaked' THEN 0 ELSE 1 END
         LIMIT 1`,
        [user.id, ev.id, ev.scheduled_day, ev.scheduled_slot, ev.conflict_group]
      );

      // Create post-hangout Feed Post tagging the user (and let the flaked/declined persona drop shade!)
      await createAutonomousBotPost({
        user: { ...user, current_day: targetDay, current_slot: targetSlot },
        persona,
        contextHint: `HANGOUT_RECAP: ${ev.title}`,
        extraDramaCommenter: spurned
          ? {
              personaId: spurned.persona_id,
              reason: `You were ${spurned.status} by ${user.display_name} at this exact time slot so they could attend "${ev.title}" with ${persona.display_name}. Comment with jealous shade or sharp irony!`,
            }
          : null,
        withCascade: true,
      });

      completedInvites.push(ev.title);
      continue;
    }

    // 2. Pending emotional hook ignored past its slot -> EXPIRE with realistic hurt reaction
    if (ev.event_type === "emotional_hook" && ev.status === "pending" && cmp < 0) {
      await dbQuery("UPDATE world_events SET status = 'expired' WHERE id = $1", [ev.id]);
      const stateUpdate = await applyUserPersonaStateUpdate(user.id, persona.id, {
        affinityDelta: ev.penalty_affinity,
        trustDelta: -4,
        newMood: "annoyed",
        internalThought: `Reached out to ${user.display_name} when I really needed someone and got left on read.`,
        incrementUnread: true,
      });
      const hookTpl = EMOTIONAL_HOOK_CATALOG.find((h) => h.personaId === persona.id);
      await deliverPersonaTurnBubbles({
        userId: user.id,
        persona,
        bubbles: [hookTpl?.ignoredReply || "nvm, sorry for bothering you. I'm fine."],
        stateUpdate,
        instant: true,
      });
      expiredEvents.push(ev.title);
      continue;
    }

    // 3. Pending invite whose scheduled slot has passed -> EXPIRE
    if (ev.event_type === "invite" && ev.status === "pending" && cmp < 0) {
      await dbQuery("UPDATE world_events SET status = 'expired' WHERE id = $1", [ev.id]);
      if (ev.dm_message_id) {
        await dbQuery(
          `UPDATE dm_messages
           SET media_metadata = jsonb_set(media_metadata, '{status}', '"expired"'::jsonb)
           WHERE id = $1`,
          [ev.dm_message_id]
        );
      }
      expiredEvents.push(ev.title);
    }
  }

  return { completedInvites, expiredEvents };
}

/**
 * Generates autonomous World Director events (Spontaneous Ping, Emotional Hook,
 * and overlapping Schedule-Conflict Invites from affinity >= 35 personas).
 */
export async function generateWorldDirectorEvents(
  user: UserRow,
  options: {
    triggerPing?: boolean;
    triggerEmotionalHook?: boolean;
    triggerConflictingInvites?: boolean;
  } = {}
): Promise<{
  createdEvents: Array<{ id: string; event_type: string; persona_id: string; title: string }>;
}> {
  const createdEvents: Array<{ id: string; event_type: string; persona_id: string; title: string }> =
    [];

  // 1. EMOTIONAL HOOK — STRICTLY GATED: requires genuine friendship & trust (affinity >= 45 AND trust >= 35)!
  // A stranger will NEVER text you at 3am about a nightmare or personal spiral.
  const shouldHook =
    options.triggerEmotionalHook ?? (user.current_slot === "late_night" && Math.random() < 0.45);

  if (shouldHook) {
    const existingPendingHook = await dbQueryOne<{ id: string }>(
      `SELECT id FROM world_events
       WHERE user_id = $1 AND event_type = 'emotional_hook' AND status = 'pending'
       LIMIT 1`,
      [user.id]
    );

    if (!existingPendingHook) {
      const trustedStates = await dbQuery<{ persona_id: string }>(
        `SELECT persona_id FROM user_persona_state
         WHERE user_id = $1 AND affinity >= 45 AND trust >= 35`,
        [user.id]
      );
      const trustedSet = new Set(trustedStates.rows.map((r) => r.persona_id));

      const eligibleHooks = EMOTIONAL_HOOK_CATALOG.filter(
        (h) => trustedSet.has(h.personaId) && h.preferredSlots.includes(user.current_slot)
      );
      const fallbackTrustedHooks = EMOTIONAL_HOOK_CATALOG.filter((h) =>
        trustedSet.has(h.personaId)
      );
      const pool = eligibleHooks.length > 0 ? eligibleHooks : fallbackTrustedHooks;

      if (pool.length > 0) {
        const picked = pool[Math.floor(Math.random() * pool.length)];
        const persona = await dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [
          picked.personaId,
        ]);
        if (persona) {
          const ev = await dbQueryOne<WorldEventRow>(
            `INSERT INTO world_events (
              user_id, persona_id, event_type, title, description,
              scheduled_day, scheduled_slot, status, reward_affinity, penalty_affinity
            ) VALUES ($1, $2, 'emotional_hook', $3, $4, $5, $6, 'pending', 8, -4)
            RETURNING *`,
            [
              user.id,
              persona.id,
              picked.title,
              picked.description,
              user.current_day,
              user.current_slot,
            ]
          );
          if (ev) {
            const stateUpdate = await applyUserPersonaStateUpdate(user.id, persona.id, {
              newMood: "suspicious",
              internalThought: `Hoping ${user.display_name} sees my text... really need a friend right now.`,
              incrementUnread: true,
            });
            await deliverPersonaTurnBubbles({
              userId: user.id,
              persona,
              bubbles: picked.bubbles,
              stateUpdate,
              instant: true,
              pushNotification: true,
            });
            createdEvents.push({
              id: ev.id,
              event_type: ev.event_type,
              persona_id: persona.id,
              title: ev.title,
            });
          }
        }
      }
    }
  }

  // 2. INVITES WITH TIERED REALISM GATES (Open campus events >= 18, Friend hangouts >= 38, Close invites >= 58!)
  // Strangers at affinity 0 will NEVER send you hangout invites!
  const shouldInvite = options.triggerConflictingInvites ?? true;
  if (shouldInvite) {
    const nextSlotObj = advanceTimeSlot(user.current_day, user.current_slot);
    const upcomingCountRow = await dbQueryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM world_events
       WHERE user_id = $1 AND event_type = 'invite' AND status IN ('pending', 'accepted')
         AND (scheduled_day > $2 OR (scheduled_day = $2 AND scheduled_slot = $3))`,
      [user.id, user.current_day, nextSlotObj.slot]
    );
    const upcomingCount = Number(upcomingCountRow?.count ?? 0);

    if (upcomingCount < 2) {
      const eligible = await dbQuery<PersonaRow & { affinity: number; dm_turns_count: number }>(
        `SELECT p.*, ups.affinity, ups.dm_turns_count
         FROM personas p
         JOIN user_persona_state ups ON ups.persona_id = p.id
         WHERE ups.user_id = $1 AND ups.affinity >= 18
         ORDER BY ups.affinity DESC, RANDOM()
         LIMIT 10`,
        [user.id]
      );

      const busyPersonasRes = await dbQuery<{ persona_id: string }>(
        `SELECT persona_id FROM world_events
         WHERE user_id = $1 AND event_type = 'invite' AND status IN ('pending', 'accepted')`,
        [user.id]
      );
      const busySet = new Set(busyPersonasRes.rows.map((r) => r.persona_id));

      // Filter strictly against each invite's minAffinity gate!
      const qualified = eligible.rows.filter((p) => {
        if (busySet.has(p.id)) return false;
        const tpl = CAMPUS_INVITE_CATALOG.find((c) => c.personaId === p.id);
        const minReq = tpl ? tpl.minAffinity : 38;
        return p.affinity >= minReq;
      });

      const conflictGroup = `day${nextSlotObj.day}_${nextSlotObj.slot}`;
      const toInvite = qualified.slice(0, Math.min(2, 2 - upcomingCount));

      for (const persona of toInvite) {
        const tpl =
          CAMPUS_INVITE_CATALOG.find((c) => c.personaId === persona.id) ||
          {
            personaId: persona.id,
            minAffinity: 38,
            title: `${persona.display_name.split(" ")[0]}'s Campus Hangout`,
            description: `${persona.display_name} wants to link up during ${TIME_SLOT_META[nextSlotObj.slot].label}.`,
            preferredSlots: [nextSlotObj.slot],
            inviteLine: `hey! got some free time ${TIME_SLOT_META[nextSlotObj.slot].label.toLowerCase()} — wanna grab coffee on campus?`,
            aftermathLine: `honestly such a good hangout today, let's do it again soon!`,
            photoPrompt: `Candid campus hangout moment with ${persona.display_name}`,
          };

        const ev = await dbQueryOne<WorldEventRow>(
          `INSERT INTO world_events (
            user_id, persona_id, event_type, title, description,
            scheduled_day, scheduled_slot, status, reward_affinity, penalty_affinity, conflict_group
          ) VALUES ($1, $2, 'invite', $3, $4, $5, $6, 'pending', 8, -10, $7)
          RETURNING *`,
          [
            user.id,
            persona.id,
            tpl.title,
            tpl.description,
            nextSlotObj.day,
            nextSlotObj.slot,
            conflictGroup,
          ]
        );

        if (ev) {
          await insertWorldEventMessage({
            userId: user.id,
            persona,
            event: ev,
            inviteLine: tpl.inviteLine,
          });
          createdEvents.push({
            id: ev.id,
            event_type: ev.event_type,
            persona_id: persona.id,
            title: ev.title,
          });
        }
      }
    }
  }

  // 3. SPONTANEOUS PING — ONLY from personas who actually know you (affinity >= 15 OR follow you back)!
  const shouldPing = options.triggerPing ?? true;
  if (shouldPing) {
    const chosen = await dbQueryOne<
      PersonaRow & {
        affinity: number;
        trust: number;
        romantic_tension: number;
        current_mood: string;
        internal_thought: string;
        relationship_stage: string;
      }
    >(
      `SELECT p.*, ups.affinity, ups.trust, ups.romantic_tension, ups.current_mood, ups.internal_thought, ups.relationship_stage
       FROM personas p
       JOIN user_persona_state ups ON ups.persona_id = p.id
       WHERE ups.user_id = $1
         AND (ups.affinity >= 15 OR ups.persona_follows_back = TRUE)
       ORDER BY CASE WHEN ups.affinity >= 30 THEN 0 ELSE 1 END, RANDOM()
       LIMIT 1`,
      [user.id]
    );

    if (chosen) {
      const memories = await retrieveTopMemories(user.id, chosen.id, user.current_slot, 3);
      const pingReasons = [
        `Spontaneous ping during ${TIME_SLOT_META[user.current_slot].label}: send a random campus update or drop a media snap if unlocked`,
        `Random check-in ping — saw something funny on campus that reminded you of ${user.display_name}`,
      ];
      const reason = pingReasons[Math.floor(Math.random() * pingReasons.length)];

      const generated = await generateProactiveDm({
        persona: chosen,
        user,
        state: {
          affinity: chosen.affinity,
          trust: chosen.trust,
          romantic_tension: chosen.romantic_tension,
          current_mood: chosen.current_mood,
          internal_thought: chosen.internal_thought,
          relationship_stage: chosen.relationship_stage,
        },
        reason,
        memories,
        allowMedia: true,
      });

      const stateUpdate = await applyUserPersonaStateUpdate(user.id, chosen.id, {
        newMood: generated.new_mood,
        internalThought: generated.internal_thought,
        incrementUnread: true,
      });

      await deliverPersonaTurnBubbles({
        userId: user.id,
        persona: chosen,
        bubbles: generated.bubbles,
        mediaAttachment: generated.media_attachment,
        stateUpdate,
        instant: true,
        pushNotification: true,
      });

      const ev = await dbQueryOne<WorldEventRow>(
        `INSERT INTO world_events (
          user_id, persona_id, event_type, title, description,
          scheduled_day, scheduled_slot, status, reward_affinity, penalty_affinity
        ) VALUES ($1, $2, 'spontaneous_ping', $3, $4, $5, $6, 'completed', 2, 0)
        RETURNING *`,
        [
          user.id,
          chosen.id,
          `Spontaneous ping from ${chosen.display_name.split(" ")[0]}`,
          generated.bubbles[0]?.slice(0, 140) || "Spontaneous DM check-in",
          user.current_day,
          user.current_slot,
        ]
      );

      if (ev) {
        createdEvents.push({
          id: ev.id,
          event_type: ev.event_type,
          persona_id: chosen.id,
          title: ev.title,
        });
      }
    }
  }

  emitRealtimeEvent(user.id, "world:update", {
    current_day: user.current_day,
    current_slot: user.current_slot,
    reason: "director_events_generated",
  });

  return { createdEvents };
}

/**
 * Backend-enforced Event Invite Response & Schedule Conflict Resolution:
 * - Only 1 accepted event per (scheduled_day, scheduled_slot)
 * - Accepting a conflicting invite requires confirmFlake=true, otherwise returns conflict info (HTTP 409)
 * - Confirming flake marks previous event `flaked`, applies penalty_affinity, sends hurt DM, and triggers gossip_leak!
 */
export async function respondToWorldEvent(params: {
  user: UserRow;
  eventId: string;
  action: "accept" | "decline";
  confirmFlake?: boolean;
}): Promise<
  | {
      ok: false;
      conflict: true;
      existingEvent: WorldEventRow;
      existingPersona: { id: string; display_name: string; handle: string; accent_color: string };
      newEvent: WorldEventRow;
    }
  | {
      ok: true;
      event: WorldEventRow;
      flakedEvent?: WorldEventRow | null;
      flakedPersonaName?: string | null;
    }
> {
  const { user, eventId, action, confirmFlake } = params;
  const ev = await dbQueryOne<WorldEventRow>(
    "SELECT * FROM world_events WHERE id = $1 AND user_id = $2",
    [eventId, user.id]
  );
  if (!ev) throw new Error("World event not found");

  const persona = await dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [
    ev.persona_id,
  ]);
  if (!persona) throw new Error("Persona not found");

  if (action === "decline") {
    const updated = await dbQueryOne<WorldEventRow>(
      "UPDATE world_events SET status = 'declined' WHERE id = $1 RETURNING *",
      [ev.id]
    );
    if (ev.dm_message_id) {
      await dbQuery(
        `UPDATE dm_messages
         SET media_metadata = jsonb_set(media_metadata, '{status}', '"declined"'::jsonb)
         WHERE id = $1`,
        [ev.dm_message_id]
      );
    }

    const stateUpdate = await applyUserPersonaStateUpdate(user.id, persona.id, {
      affinityDelta: -2,
      newMood: "chill",
      internalThought: `${user.display_name} passed on "${ev.title}". Fair enough, maybe next time.`,
    });

    await deliverPersonaTurnBubbles({
      userId: user.id,
      persona,
      bubbles: [
        `all good, no stress — we'll catch up another time!`,
      ],
      stateUpdate,
      instant: true,
    });

    emitRealtimeEvent(user.id, "world:update", { reason: "invite_declined" });
    return { ok: true, event: updated! };
  }

  // Action === "accept": enforce max 1 accepted event per (scheduled_day, scheduled_slot)!
  const conflicting = await dbQueryOne<WorldEventRow>(
    `SELECT * FROM world_events
     WHERE user_id = $1
       AND event_type = 'invite'
       AND status = 'accepted'
       AND scheduled_day = $2
       AND scheduled_slot = $3
       AND id <> $4
     LIMIT 1`,
    [user.id, ev.scheduled_day, ev.scheduled_slot, ev.id]
  );

  if (conflicting && !confirmFlake) {
    const existingPersona = await dbQueryOne<{
      id: string;
      display_name: string;
      handle: string;
      accent_color: string;
    }>("SELECT id, display_name, handle, accent_color FROM personas WHERE id = $1", [
      conflicting.persona_id,
    ]);
    return {
      ok: false,
      conflict: true,
      existingEvent: conflicting,
      existingPersona: existingPersona || {
        id: conflicting.persona_id,
        display_name: conflicting.persona_id,
        handle: `@${conflicting.persona_id}`,
        accent_color: "#E5484D",
      },
      newEvent: ev,
    };
  }

  let flakedEvent: WorldEventRow | null = null;
  let flakedPersonaName: string | null = null;

  if (conflicting && confirmFlake) {
    flakedEvent = await dbQueryOne<WorldEventRow>(
      "UPDATE world_events SET status = 'flaked' WHERE id = $1 RETURNING *",
      [conflicting.id]
    );
    if (conflicting.dm_message_id) {
      await dbQuery(
        `UPDATE dm_messages
         SET media_metadata = jsonb_set(media_metadata, '{status}', '"flaked"'::jsonb)
         WHERE id = $1`,
        [conflicting.dm_message_id]
      );
    }

    const flakedPersona = await dbQueryOne<PersonaRow>("SELECT * FROM personas WHERE id = $1", [
      conflicting.persona_id,
    ]);
    if (flakedPersona) {
      flakedPersonaName = flakedPersona.display_name;
      const penaltyState = await applyUserPersonaStateUpdate(user.id, flakedPersona.id, {
        affinityDelta: conflicting.penalty_affinity,
        trustDelta: -8,
        newMood: "annoyed",
        internalThought: `${user.display_name} literally flaked on "${conflicting.title}" to go hang with ${persona.display_name.split(" ")[0]}. Unreal.`,
        incrementUnread: true,
      });

      await deliverPersonaTurnBubbles({
        userId: user.id,
        persona: flakedPersona,
        bubbles: [
          `wait seriously?? you're bailing on "${conflicting.title}" after you already said yes??`,
          `heard you picked ${persona.display_name.split(" ")[0]}'s plans instead. cool. good to know where I stand.`,
        ],
        stateUpdate: penaltyState,
        instant: true,
        pushNotification: true,
      });

      // Trigger campus gossip leak about the flake!
      await propagateGossip({
        userId: user.id,
        originPersonaId: flakedPersona.id,
        summary: `${user.display_name} flaked on ${flakedPersona.display_name.split(" ")[0]}'s "${conflicting.title}" to go with ${persona.display_name.split(" ")[0]} instead`,
        juiciness: 7,
      });
    }
  }

  // Mark the new invite as ACCEPTED
  const accepted = await dbQueryOne<WorldEventRow>(
    "UPDATE world_events SET status = 'accepted' WHERE id = $1 RETURNING *",
    [ev.id]
  );
  if (ev.dm_message_id) {
    await dbQuery(
      `UPDATE dm_messages
       SET media_metadata = jsonb_set(media_metadata, '{status}', '"accepted"'::jsonb)
       WHERE id = $1`,
      [ev.dm_message_id]
    );
  }

  const acceptState = await applyUserPersonaStateUpdate(user.id, persona.id, {
    affinityDelta: 3,
    newMood: "hyped",
    internalThought: `${user.display_name} locked in for "${ev.title}"! Can't wait.`,
  });

  await deliverPersonaTurnBubbles({
    userId: user.id,
    persona,
    bubbles: [
      `yesss locked in!! see you for "${ev.title}" on Day ${ev.scheduled_day} (${TIME_SLOT_META[ev.scheduled_slot].label}) 🔥`,
    ],
    stateUpdate: acceptState,
    instant: true,
  });

  emitRealtimeEvent(user.id, "world:update", { reason: "invite_accepted" });
  return {
    ok: true,
    event: accepted!,
    flakedEvent,
    flakedPersonaName,
  };
}
