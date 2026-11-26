import fs from "fs";
import path from "path";
import { dbExec, dbQuery, dbQueryOne } from "./client";
import { PERSONA_SEEDS } from "../personas/metadata";
import seedEdgesJson from "../../../db/seed_graph_edges_en.json";

interface EdgeSeed {
  source_id: string;
  target_id: string;
  relation_type: string;
  affinity: number;
  friction: number;
  gossip_trust: number;
  shared_lore: string;
}

const EDGE_SEEDS: EdgeSeed[] = seedEdgesJson as EdgeSeed[];

const globalForMigrate = globalThis as unknown as {
  __circleMigrated?: boolean;
  __circleMigratePromise?: Promise<void>;
};

export async function runMigrationsAndSeed(forceReseed = false): Promise<{
  personasCount: number;
  edgesCount: number;
}> {
  const schemaPath = path.resolve(process.cwd(), "db", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  await dbExec(schemaSql);

  // Safe idempotent column upgrades for existing local PGlite / Postgres databases
  await dbExec(`
    ALTER TABLE user_persona_state ALTER COLUMN affinity SET DEFAULT 0;
    ALTER TABLE user_persona_state ALTER COLUMN trust SET DEFAULT 0;
    ALTER TABLE user_persona_state ADD COLUMN IF NOT EXISTS user_follows BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE user_persona_state ADD COLUMN IF NOT EXISTS persona_follows_back BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE user_persona_state ADD COLUMN IF NOT EXISTS is_close_friend BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE user_persona_state ADD COLUMN IF NOT EXISTS persona_added_close_friend BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE user_persona_state ADD COLUMN IF NOT EXISTS is_rival BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE user_persona_state ADD COLUMN IF NOT EXISTS dm_turns_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE user_persona_state ADD COLUMN IF NOT EXISTS dm_last_seen_at TIMESTAMPTZ;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS location_tag VARCHAR(80);
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'campus';
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS liked_by_user BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS reaction VARCHAR(16);
    ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES dm_messages(id) ON DELETE SET NULL;
    ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_post_likes_user ON post_likes(post_id, user_id) WHERE liker_type = 'user';
    CREATE UNIQUE INDEX IF NOT EXISTS uq_post_likes_persona ON post_likes(post_id, liker_persona_id) WHERE liker_type = 'persona';
    ALTER TABLE dm_messages DROP CONSTRAINT IF EXISTS dm_messages_message_type_check;
    ALTER TABLE dm_messages ADD CONSTRAINT dm_messages_message_type_check
      CHECK (message_type IN ('text', 'image', 'audio', 'video', 'screenshot_alert', 'post_share', 'event_invite', 'story_reply', 'note_reply'));
  `);

  const countRow = await dbQueryOne<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM personas"
  );
  const edgeRow = await dbQueryOne<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM persona_edges"
  );
  const svgAvatarRow = await dbQueryOne<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM personas WHERE avatar_url LIKE '%.svg'"
  );
  const existingPersonas = Number(countRow?.count ?? 0);
  const existingEdges = Number(edgeRow?.count ?? 0);
  const hasLegacySvg = Number(svgAvatarRow?.count ?? 0) > 0;

  if (
    forceReseed ||
    hasLegacySvg ||
    existingPersonas < PERSONA_SEEDS.length ||
    existingEdges < EDGE_SEEDS.length
  ) {
    for (const p of PERSONA_SEEDS) {
      await dbQuery(
        `INSERT INTO personas (
          id, display_name, handle, clique, archetype, avatar_url, accent_color,
          age, bio, personality_prompt, typing_style, voice_profile, visual_anchor,
          secrets, triggers, gossip_propensity, activity_schedule, is_active
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11::jsonb, $12::jsonb, $13,
          $14::jsonb, $15::jsonb, $16, $17::jsonb, TRUE
        )
        ON CONFLICT (id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          handle = EXCLUDED.handle,
          clique = EXCLUDED.clique,
          archetype = EXCLUDED.archetype,
          avatar_url = EXCLUDED.avatar_url,
          accent_color = EXCLUDED.accent_color,
          age = EXCLUDED.age,
          bio = EXCLUDED.bio,
          personality_prompt = EXCLUDED.personality_prompt,
          typing_style = EXCLUDED.typing_style,
          voice_profile = EXCLUDED.voice_profile,
          visual_anchor = EXCLUDED.visual_anchor,
          secrets = EXCLUDED.secrets,
          triggers = EXCLUDED.triggers,
          gossip_propensity = EXCLUDED.gossip_propensity,
          activity_schedule = EXCLUDED.activity_schedule,
          is_active = TRUE`,
        [
          p.id,
          p.display_name,
          p.handle,
          p.clique,
          p.archetype,
          p.avatar_url,
          p.accent_color,
          p.age,
          p.bio,
          p.personality_prompt,
          JSON.stringify(p.typing_style),
          JSON.stringify(p.voice_profile),
          p.visual_anchor,
          JSON.stringify(p.secrets),
          JSON.stringify(p.triggers),
          p.gossip_propensity,
          JSON.stringify(p.activity_schedule),
        ]
      );
    }

    for (const e of EDGE_SEEDS) {
      await dbQuery(
        `INSERT INTO persona_edges (
          source_id, target_id, relation_type, affinity, friction, gossip_trust, shared_lore
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (source_id, target_id) DO UPDATE SET
          relation_type = EXCLUDED.relation_type,
          affinity = EXCLUDED.affinity,
          friction = EXCLUDED.friction,
          gossip_trust = EXCLUDED.gossip_trust,
          shared_lore = EXCLUDED.shared_lore`,
        [
          e.source_id,
          e.target_id,
          e.relation_type,
          e.affinity,
          e.friction,
          e.gossip_trust,
          e.shared_lore,
        ]
      );
    }
  }

  const finalPersonas = await dbQueryOne<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM personas"
  );
  const finalEdges = await dbQueryOne<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM persona_edges"
  );
  globalForMigrate.__circleMigrated = true;
  return {
    personasCount: Number(finalPersonas?.count ?? 0),
    edgesCount: Number(finalEdges?.count ?? 0),
  };
}

export async function ensureDbReady(): Promise<void> {
  if (globalForMigrate.__circleMigrated) return;
  if (!globalForMigrate.__circleMigratePromise) {
    globalForMigrate.__circleMigratePromise = runMigrationsAndSeed(false)
      .then(() => undefined)
      .catch((err) => {
        globalForMigrate.__circleMigratePromise = undefined;
        throw err;
      });
  }
  await globalForMigrate.__circleMigratePromise;
}
