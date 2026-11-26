import { dbQuery, dbQueryOne } from "../db/client";
import { scaleDelayMs } from "../config/runtime";
import { storeMemoryWithEmbedding } from "../llm/embeddings";
import { PERSONA_SEEDS } from "../personas/metadata";
import { emitRealtimeEvent } from "../realtime/bus";

interface GossipRouteRow {
  source_id: string;
  target_id: string;
  gossip_propensity: number;
  gossip_trust: number;
  leak_probability: string | number;
  relation_type: string;
}

export interface GossipPropagationResult {
  eventId: string | null;
  originPersonaId: string;
  reachedPersonas: string[];
  hops: Array<{ from: string; to: string; hop: number; prob: number; relation: string }>;
  scheduledConfrontations: string[];
}

function findMentionedPersonaIds(summary: string): string[] {
  const lower = summary.toLowerCase();
  const hits: string[] = [];
  for (const p of PERSONA_SEEDS) {
    const first = p.display_name.split(" ")[0].toLowerCase();
    if (
      new RegExp(`\\b${p.id}\\b`, "i").test(lower) ||
      new RegExp(`\\b${first}\\b`, "i").test(lower)
    ) {
      hits.push(p.id);
    }
  }
  return hits;
}

/**
 * Exact 2-hop Gossip Propagation Engine from specs/05_prompts_and_schemas.json:
 * 1. Triggered when gossip_candidate.juiciness >= 6.
 * 2. Queries `v_gossip_routes` for source_id = origin_persona_id.
 * 3. For each target_id, computes P_leak = leak_probability * (juiciness / 10).
 * 4. Traverses up to 2 hops (without cycling back to origin or already-reached bots).
 * 5. Inserts `memories` rows with source_type = 'gossip' and leaked_by_persona = source_id.
 * 6. If target has romantic_tension > 40 OR relation_type == 'ex' with someone mentioned,
 *    schedules a `proactive_dm` in 5 to 40 minutes (scaled by speed multiplier).
 */
export async function propagateGossip(params: {
  userId: string;
  originPersonaId: string;
  summary: string;
  juiciness: number;
}): Promise<GossipPropagationResult> {
  const { userId, originPersonaId, summary, juiciness } = params;

  if (juiciness < 6) {
    return {
      eventId: null,
      originPersonaId,
      reachedPersonas: [],
      hops: [],
      scheduledConfrontations: [],
    };
  }

  const reached = new Set<string>();
  const hops: Array<{ from: string; to: string; hop: number; prob: number; relation: string }> = [];
  const hop1Winners: string[] = [];

  // HOP 1: query SQL view v_gossip_routes
  const hop1Routes = await dbQuery<GossipRouteRow>(
    `SELECT source_id, target_id, gossip_propensity, gossip_trust, leak_probability, relation_type
     FROM v_gossip_routes
     WHERE source_id = $1
     ORDER BY leak_probability DESC`,
    [originPersonaId]
  );

  for (const route of hop1Routes.rows) {
    if (route.target_id === originPersonaId || reached.has(route.target_id)) continue;
    const baseProb = Number(route.leak_probability);
    const pLeak = Math.min(0.98, baseProb * (juiciness / 10));
    if (Math.random() <= pLeak) {
      reached.add(route.target_id);
      hop1Winners.push(route.target_id);
      hops.push({
        from: originPersonaId,
        to: route.target_id,
        hop: 1,
        prob: Number(pLeak.toFixed(3)),
        relation: route.relation_type,
      });
    }
  }

  // High-juiciness safeguard for ultra-gossipy hubs (like Bella 0.95 -> Jade 0.95) so RNG never feels broken
  if (hop1Winners.length === 0 && hop1Routes.rows[0] && juiciness >= 7) {
    const top = hop1Routes.rows[0];
    const pLeak = Number(top.leak_probability) * (juiciness / 10);
    if (pLeak >= 0.45) {
      reached.add(top.target_id);
      hop1Winners.push(top.target_id);
      hops.push({
        from: originPersonaId,
        to: top.target_id,
        hop: 1,
        prob: Number(pLeak.toFixed(3)),
        relation: top.relation_type,
      });
    }
  }

  // HOP 2: traverse outgoing v_gossip_routes from hop-1 winners (max 2 hops!)
  for (const midId of hop1Winners) {
    const hop2Routes = await dbQuery<GossipRouteRow>(
      `SELECT source_id, target_id, gossip_propensity, gossip_trust, leak_probability, relation_type
       FROM v_gossip_routes
       WHERE source_id = $1
       ORDER BY leak_probability DESC`,
      [midId]
    );
    for (const route of hop2Routes.rows) {
      if (route.target_id === originPersonaId || reached.has(route.target_id)) continue;
      const baseProb = Number(route.leak_probability);
      const pLeak = Math.min(0.95, baseProb * (juiciness / 10));
      if (Math.random() <= pLeak) {
        reached.add(route.target_id);
        hops.push({
          from: midId,
          to: route.target_id,
          hop: 2,
          prob: Number(pLeak.toFixed(3)),
          relation: route.relation_type,
        });
      }
    }
  }

  const reachedList = Array.from(reached);

  // Record the gossip propagation event in `gossip_events`
  const eventRow = await dbQueryOne<{ id: string }>(
    `INSERT INTO gossip_events (user_id, origin_persona_id, summary, juiciness, reached_personas)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [userId, originPersonaId, summary, juiciness, JSON.stringify(reachedList)]
  );

  const mentionedIds = findMentionedPersonaIds(summary);
  const scheduledConfrontations: string[] = [];

  // Insert leaked memories (with 768-d pgvector embedding) and evaluate confrontation proactive DMs
  for (const hopEntry of hops) {
    await storeMemoryWithEmbedding({
      userId,
      personaId: hopEntry.to,
      fact: summary,
      category: juiciness >= 8 ? "secret" : "drama",
      importance: juiciness,
      sourceType: "gossip",
      leakedByPersona: hopEntry.from,
    });

    // Check rule 5: romantic_tension > 40 OR relation_type == 'ex' with someone mentioned in the gossip
    const stateRow = await dbQueryOne<{ romantic_tension: number }>(
      `SELECT romantic_tension FROM user_persona_state
       WHERE user_id = $1 AND persona_id = $2`,
      [userId, hopEntry.to]
    );

    let hasExConnection = false;
    if (mentionedIds.length > 0) {
      const exCheck = await dbQuery<{ target_id: string }>(
        `SELECT target_id FROM persona_edges
         WHERE source_id = $1 AND relation_type = 'ex' AND target_id = ANY($2::text[])`,
        [hopEntry.to, mentionedIds]
      );
      hasExConnection = exCheck.rows.length > 0;
    }

    const romanticTension = stateRow?.romantic_tension ?? 0;
    const isDirectSubject = mentionedIds.includes(hopEntry.to);

    if (romanticTension > 40 || hasExConnection || isDirectSubject) {
      // Literal delay: 5 to 40 minutes, scaled by Simulation Speed Multiplier
      const literalDelayMs = (5 + Math.random() * 35) * 60 * 1000;
      const runAt = new Date(Date.now() + scaleDelayMs(literalDelayMs, 5000));

      await dbQuery(
        `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
         VALUES ($1, 'proactive_dm', $2::jsonb, $3, 'pending')`,
        [
          userId,
          JSON.stringify({
            persona_id: hopEntry.to,
            reason: hasExConnection
              ? `Gossip leaked by ${hopEntry.from} involving your ex (${mentionedIds.join(", ")}): "${summary}". Confront the user subtly or sharply.`
              : `Gossip leaked by ${hopEntry.from}: "${summary}". Reach out and bring it up in DM.`,
            leaked_by: hopEntry.from,
            gossip_event_id: eventRow?.id ?? null,
          }),
          runAt.toISOString(),
        ]
      );
      scheduledConfrontations.push(hopEntry.to);
    }
  }

  if (reachedList.length > 0) {
    emitRealtimeEvent(userId, "world:update", {
      reason: `gossip_leaked:${originPersonaId}->${reachedList.join(",")}`,
    });
  }

  return {
    eventId: eventRow?.id ?? null,
    originPersonaId,
    reachedPersonas: reachedList,
    hops,
    scheduledConfrontations,
  };
}
