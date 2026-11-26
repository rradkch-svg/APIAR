import { dbQuery, dbQueryOne, dbTransaction } from "../db/client";
import { ensureDbReady } from "../db/migrate";
import type { UserRow } from "../db/session";
import { advanceTimeSlot, type PersonaRow, type TimeSlot } from "../personas/metadata";
import { emitRealtimeEvent } from "../realtime/bus";
import { executeScheduledJob, type ScheduledJobRow } from "./handlers";
import { createAutonomousBotPost, refreshCampusStoriesAndNotes } from "./lazy-feed";
import { generateWorldDirectorEvents, resolveWorldEventsForSlot } from "./director";

const globalForWorkers = globalThis as unknown as {
  __circleWorkersStarted?: boolean;
  __circlePollerInterval?: ReturnType<typeof setInterval>;
  __circleCronInterval?: ReturnType<typeof setInterval>;
  __circlePollingBusy?: boolean;
};

/**
 * job_poller_worker (every 5 seconds) using exact SQL pattern from 06_api_and_workers.yaml:
 * SELECT ... FROM scheduled_jobs WHERE status='pending' AND run_at <= NOW() FOR UPDATE SKIP LOCKED
 */
export async function pollAndRunDueJobs(limit = 5, onlyUserId?: string): Promise<number> {
  await ensureDbReady();

  const claimed = await dbTransaction<ScheduledJobRow[]>(async (tx) => {
    const sql = onlyUserId
      ? `SELECT * FROM scheduled_jobs
         WHERE status = 'pending' AND user_id = $1 AND run_at <= NOW()
         ORDER BY run_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`
      : `SELECT * FROM scheduled_jobs
         WHERE status = 'pending' AND run_at <= NOW()
         ORDER BY run_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`;
    const params = onlyUserId ? [onlyUserId, limit] : [limit];
    const res = await tx.query<ScheduledJobRow>(sql, params);
    if (res.rows.length === 0) return [];

    const ids = res.rows.map((r) => r.id);
    await tx.query(
      `UPDATE scheduled_jobs
       SET status = 'processing', attempts = attempts + 1
       WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    return res.rows;
  });

  for (const job of claimed) {
    try {
      await executeScheduledJob(job);
      await dbQuery("UPDATE scheduled_jobs SET status = 'done', last_error = NULL WHERE id = $1", [
        job.id,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const nextStatus = job.attempts + 1 >= 3 ? "failed" : "pending";
      const backoff = new Date(Date.now() + 10000).toISOString();
      await dbQuery(
        `UPDATE scheduled_jobs
         SET status = $2, last_error = $3, run_at = CASE WHEN $2 = 'pending' THEN $4::timestamptz ELSE run_at END
         WHERE id = $1`,
        [job.id, nextStatus, msg.slice(0, 500), backoff]
      );
      console.error(`[worker] Job ${job.job_type} (${job.id}) failed:`, msg);
    }
  }

  return claimed.length;
}

/**
 * Flushes all currently pending jobs for a user immediately (used when simulating time +6h/+24h).
 */
export async function flushPendingJobsForUser(userId: string, maxJobs = 12): Promise<number> {
  await dbQuery(
    `UPDATE scheduled_jobs
     SET run_at = NOW()
     WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );
  let total = 0;
  for (let pass = 0; pass < 3; pass++) {
    const n = await pollAndRunDueJobs(maxJobs, userId);
    total += n;
    if (n === 0) break;
  }
  return total;
}

/**
 * proactive_reengagement_cron (every 3 hours) from 06_api_and_workers.yaml:
 * For users active in the last 48h, picks 1 persona with affinity > 35 or pending gossip
 * and triggers proactive_dm / bot_post + autonomous World Director events.
 */
export async function runProactiveReengagementCron(): Promise<void> {
  await ensureDbReady();
  const activeUsers = await dbQuery<UserRow>(
    `SELECT * FROM users WHERE last_active_at >= NOW() - INTERVAL '48 hours'`
  );

  for (const user of activeUsers.rows) {
    try {
      const gossipTarget = await dbQueryOne<{ persona_id: string; fact: string }>(
        `SELECT persona_id, fact FROM memories
         WHERE user_id = $1 AND source_type = 'gossip'
         ORDER BY created_at DESC LIMIT 1`,
        [user.id]
      );

      if (gossipTarget && Math.random() < 0.6) {
        await dbQuery(
          `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
           VALUES ($1, 'proactive_dm', $2::jsonb, NOW(), 'pending')`,
          [
            user.id,
            JSON.stringify({
              persona_id: gossipTarget.persona_id,
              reason: `Following up on campus gossip you heard: ${gossipTarget.fact}`,
            }),
          ]
        );
      } else {
        const friendly = await dbQueryOne<{ persona_id: string }>(
          `SELECT persona_id FROM user_persona_state
           WHERE user_id = $1 AND affinity > 35
           ORDER BY RANDOM() LIMIT 1`,
          [user.id]
        );
        if (friendly) {
          const jobType = Math.random() < 0.5 ? "proactive_dm" : "bot_post";
          await dbQuery(
            `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
             VALUES ($1, $2, $3::jsonb, NOW(), 'pending')`,
            [
              user.id,
              jobType,
              JSON.stringify({
                persona_id: friendly.persona_id,
                reason: "Spontaneous check-in from campus crew",
              }),
            ]
          );
        }
      }

      await generateWorldDirectorEvents(user, {
        triggerPing: false,
        triggerEmotionalHook: user.current_slot === "late_night",
        triggerConflictingInvites: true,
      });
    } catch (err) {
      console.error("[cron] Re-engagement error for user", user.id, err);
    }
  }
}

/**
 * Advances logical campus time:
 * - mode === "slot" (+6h): moves to next TimeSlot (morning -> afternoon -> evening -> late_night -> next day),
 *   resolves events arriving/expiring, flushes pending jobs, and triggers World Director events!
 * - mode === "day" (+24h): advances +1 full day, resets energy to max_energy, resolves intermediate events,
 *   flushes pending jobs, creates 2 new bot posts, and triggers 2-3 proactive DMs (gossip + director).
 */
export async function simulateCampusTime(
  userId: string,
  mode: "slot" | "day" = "day"
): Promise<{
  user: UserRow;
  flushedJobs: number;
  completedInvites: string[];
  expiredEvents: string[];
  createdPosts: Array<{ id: string; author_persona_id: string; body: string }>;
  directorEvents: Array<{ id: string; event_type: string; persona_id: string; title: string }>;
}> {
  const user = await dbQueryOne<UserRow>("SELECT * FROM users WHERE id = $1", [userId]);
  if (!user) throw new Error("User not found");

  let nextDay = user.current_day;
  let nextSlot: TimeSlot = user.current_slot;

  if (mode === "slot") {
    const stepped = advanceTimeSlot(user.current_day, user.current_slot);
    nextDay = stepped.day;
    nextSlot = stepped.slot;
  } else {
    nextDay = user.current_day + 1;
    nextSlot = user.current_slot;
  }

  const updatedUser = await dbQueryOne<UserRow>(
    mode === "day"
      ? `UPDATE users
         SET current_day = $2,
             current_slot = $3,
             energy = max_energy,
             energy_reset_at = NOW(),
             last_active_at = NOW()
         WHERE id = $1
         RETURNING *`
      : `UPDATE users
         SET current_day = $2,
             current_slot = $3,
             energy = LEAST(max_energy, energy + 5),
             last_active_at = NOW()
         WHERE id = $1
         RETURNING *`,
    [user.id, nextDay, nextSlot]
  );

  const activeUser = updatedUser ?? { ...user, current_day: nextDay, current_slot: nextSlot };

  // 1. Flush any due/pending background jobs (comments, gossip leaks, queued DMs)
  const flushedJobs = await flushPendingJobsForUser(activeUser.id, 15);

  // 2. Resolve World Events whose scheduled (day, slot) has been reached or passed
  const { completedInvites, expiredEvents } = await resolveWorldEventsForSlot(
    activeUser,
    nextDay,
    nextSlot
  );

  const createdPosts: Array<{ id: string; author_persona_id: string; body: string }> = [];

  if (mode === "day") {
    // Spec requirement: +24h generates 2 bot posts + 2-3 proactive DMs based on memory/gossip!
    const botAuthors = await dbQuery<PersonaRow>(
      "SELECT * FROM personas WHERE is_active = TRUE ORDER BY RANDOM() LIMIT 2"
    );
    for (const bot of botAuthors.rows) {
      const p = await createAutonomousBotPost({
        user: activeUser,
        persona: bot,
        withCascade: true,
      });
      if (p) createdPosts.push(p);
    }

    // Trigger 2 proactive DMs (prioritizing leaked gossip memories + high affinity personas)
    const gossipCandidates = await dbQuery<{ persona_id: string; fact: string; leaked_by_persona: string | null }>(
      `SELECT DISTINCT ON (persona_id) persona_id, fact, leaked_by_persona
       FROM memories
       WHERE user_id = $1 AND source_type = 'gossip'
       ORDER BY persona_id, created_at DESC
       LIMIT 2`,
      [activeUser.id]
    );

    const dmPersonaIds = new Set<string>();
    for (const g of gossipCandidates.rows) {
      dmPersonaIds.add(g.persona_id);
      await dbQuery(
        `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
         VALUES ($1, 'proactive_dm', $2::jsonb, NOW(), 'pending')`,
        [
          activeUser.id,
          JSON.stringify({
            persona_id: g.persona_id,
            reason: `Confrontation/check-in based on gossip leaked by ${g.leaked_by_persona || "a friend"}: ${g.fact}`,
            instant: true,
          }),
        ]
      );
    }

    if (dmPersonaIds.size < 2) {
      // ONLY personas you actually know (affinity >= 15 or follow back) randomly text you!
      const friendly = await dbQuery<{ persona_id: string }>(
        `SELECT persona_id FROM user_persona_state
         WHERE user_id = $1 AND (affinity >= 15 OR persona_follows_back = TRUE)
         ORDER BY affinity DESC, RANDOM()
         LIMIT 4`,
        [activeUser.id]
      );
      for (const f of friendly.rows) {
        if (dmPersonaIds.size >= 2) break;
        if (dmPersonaIds.has(f.persona_id)) continue;
        dmPersonaIds.add(f.persona_id);
        await dbQuery(
          `INSERT INTO scheduled_jobs (user_id, job_type, payload, run_at, status)
           VALUES ($1, 'proactive_dm', $2::jsonb, NOW(), 'pending')`,
          [
            activeUser.id,
            JSON.stringify({
              persona_id: f.persona_id,
              reason: `New day check-in on Day ${activeUser.current_day}: casual campus chat`,
              instant: true,
            }),
          ]
        );
      }
    }

    await refreshCampusStoriesAndNotes(activeUser, 4);
    await flushPendingJobsForUser(activeUser.id, 10);
  }

  // 3. Generate World Director autonomous events (Pings, late_night Emotional Hooks, Conflicting Invites)
  const { createdEvents: directorEvents } = await generateWorldDirectorEvents(activeUser, {
    triggerPing: true,
    triggerEmotionalHook: activeUser.current_slot === "late_night",
    triggerConflictingInvites: true,
  });

  emitRealtimeEvent(activeUser.id, "world:update", {
    current_day: activeUser.current_day,
    current_slot: activeUser.current_slot,
    reason: mode === "day" ? "simulated_24h" : "simulated_6h_slot",
  });

  return {
    user: activeUser,
    flushedJobs,
    completedInvites,
    expiredEvents,
    createdPosts,
    directorEvents,
  };
}

export function startBackgroundWorkers(): void {
  if (globalForWorkers.__circleWorkersStarted) return;
  globalForWorkers.__circleWorkersStarted = true;

  // 1. job_poller_worker — every 5 seconds
  globalForWorkers.__circlePollerInterval = setInterval(async () => {
    if (globalForWorkers.__circlePollingBusy) return;
    globalForWorkers.__circlePollingBusy = true;
    try {
      await pollAndRunDueJobs(5);
    } catch (err) {
      console.error("[worker] Poller cycle error:", err);
    } finally {
      globalForWorkers.__circlePollingBusy = false;
    }
  }, 5000);

  // 2. proactive_reengagement_cron — every 3 hours
  globalForWorkers.__circleCronInterval = setInterval(async () => {
    try {
      await runProactiveReengagementCron();
    } catch (err) {
      console.error("[cron] Re-engagement cron error:", err);
    }
  }, 3 * 60 * 60 * 1000);

  console.log("[workers] Started job_poller_worker (5s) + proactive_reengagement_cron (3h).");
}
