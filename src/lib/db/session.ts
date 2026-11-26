import { cookies } from "next/headers";
import { dbQuery, dbQueryOne } from "./client";
import { ensureDbReady } from "./migrate";
import type { TimeSlot } from "../personas/metadata";

export const SESSION_COOKIE_NAME = "circle_user_id";

export interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  context_tag: string;
  avatar_url: string | null;
  energy: number;
  max_energy: number;
  energy_reset_at: string;
  plan_tier: "free" | "pro";
  gold_balance: number;
  current_day: number;
  current_slot: TimeSlot;
  last_active_at: string;
  created_at: string;
}

export async function getActiveUser(explicitUserId?: string): Promise<UserRow | null> {
  await ensureDbReady();

  let userId = explicitUserId;
  if (!userId) {
    try {
      const store = await cookies();
      userId = store.get(SESSION_COOKIE_NAME)?.value;
    } catch {
      // Called outside Next request context (e.g. background worker)
    }
  }

  let user: UserRow | null = null;
  if (userId) {
    user = await dbQueryOne<UserRow>("SELECT * FROM users WHERE id = $1", [userId]);
  }
  if (!user) {
    // Single-player convenience fallback: load most recently active user
    user = await dbQueryOne<UserRow>(
      "SELECT * FROM users ORDER BY last_active_at DESC, created_at DESC LIMIT 1"
    );
  }
  if (!user) return null;

  // Automatic 24h energy reset
  const resetTime = new Date(user.energy_reset_at).getTime();
  const hoursElapsed = (Date.now() - resetTime) / (1000 * 60 * 60);
  if (hoursElapsed >= 24) {
    const updated = await dbQueryOne<UserRow>(
      `UPDATE users
       SET energy = max_energy, energy_reset_at = NOW(), last_active_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [user.id]
    );
    if (updated) return updated;
  } else {
    await dbQuery("UPDATE users SET last_active_at = NOW() WHERE id = $1", [user.id]);
  }

  return user;
}

export async function consumeUserEnergy(
  userId: string,
  amount = 1
): Promise<{ ok: boolean; energy: number; max_energy: number }> {
  const user = await dbQueryOne<UserRow>("SELECT * FROM users WHERE id = $1", [userId]);
  if (!user) return { ok: false, energy: 0, max_energy: 20 };

  // Pro plan gets high ceiling / generous energy; still tracks usage cleanly
  if (user.energy < amount) {
    return { ok: false, energy: user.energy, max_energy: user.max_energy };
  }

  const updated = await dbQueryOne<{ energy: number; max_energy: number }>(
    `UPDATE users
     SET energy = GREATEST(0, energy - $2), last_active_at = NOW()
     WHERE id = $1
     RETURNING energy, max_energy`,
    [userId, amount]
  );

  return {
    ok: true,
    energy: updated?.energy ?? user.energy - amount,
    max_energy: updated?.max_energy ?? user.max_energy,
  };
}
