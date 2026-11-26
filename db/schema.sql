-- =============================================================================
-- VELA — REALISTIC CAMPUS AI SOCIAL NETWORK — POSTGRESQL + PGVECTOR DDL
-- Full Instagram Parity (minus Reels) + Zero-Intimacy Cold Start + World Director
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- -----------------------------------------------------------------------------
-- 1. USERS & AUTH (+ Campus Logical Clock: day_index & time slot)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    handle          VARCHAR(32) UNIQUE NOT NULL,
    display_name    VARCHAR(80) NOT NULL,
    bio             TEXT DEFAULT '',
    context_tag     VARCHAR(40) DEFAULT 'undergrad',
    avatar_url      TEXT,
    energy          INTEGER NOT NULL DEFAULT 20,
    max_energy      INTEGER NOT NULL DEFAULT 20,
    energy_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    plan_tier       VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro')),
    gold_balance    INTEGER NOT NULL DEFAULT 0,
    current_day     INTEGER NOT NULL DEFAULT 1,
    current_slot    VARCHAR(20) NOT NULL DEFAULT 'morning' CHECK (current_slot IN ('morning', 'afternoon', 'evening', 'late_night')),
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. AI PERSONAS (NODES IN THE SOCIAL GRAPH)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personas (
    id                  VARCHAR(32) PRIMARY KEY,
    display_name        VARCHAR(80) NOT NULL,
    handle              VARCHAR(32) UNIQUE NOT NULL,
    clique              VARCHAR(40) NOT NULL,
    archetype           VARCHAR(80) NOT NULL,
    avatar_url          TEXT,
    accent_color        VARCHAR(16) NOT NULL,
    age                 INTEGER NOT NULL,
    bio                 TEXT NOT NULL,
    personality_prompt  TEXT NOT NULL,
    typing_style        JSONB NOT NULL,
    voice_profile       JSONB NOT NULL DEFAULT '{}'::jsonb,
    visual_anchor       TEXT NOT NULL DEFAULT '',
    secrets             JSONB NOT NULL DEFAULT '[]'::jsonb,
    triggers            JSONB NOT NULL DEFAULT '{}'::jsonb,
    gossip_propensity   REAL NOT NULL DEFAULT 0.5 CHECK (gossip_propensity BETWEEN 0 AND 1),
    activity_schedule   JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

-- -----------------------------------------------------------------------------
-- 3. DIRECTED WEIGHTED SOCIAL GRAPH (BOT <-> BOT EDGES)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS persona_edges (
    source_id           VARCHAR(32) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    target_id           VARCHAR(32) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    relation_type       VARCHAR(32) NOT NULL,
    affinity            INTEGER NOT NULL DEFAULT 0 CHECK (affinity BETWEEN -100 AND 100),
    friction            REAL NOT NULL DEFAULT 0.2 CHECK (friction BETWEEN 0 AND 1),
    gossip_trust        REAL NOT NULL DEFAULT 0.3 CHECK (gossip_trust BETWEEN 0 AND 1),
    shared_lore         TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (source_id, target_id),
    CHECK (source_id <> target_id)
);

CREATE INDEX IF NOT EXISTS idx_persona_edges_source ON persona_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_persona_edges_target ON persona_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_persona_edges_gossip ON persona_edges(source_id, gossip_trust DESC);

-- -----------------------------------------------------------------------------
-- 4. USER <-> PERSONA DYNAMIC STATE (TRUE COLD START: ALL START AT 0!)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_persona_state (
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona_id           VARCHAR(32) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    affinity             INTEGER NOT NULL DEFAULT 0 CHECK (affinity BETWEEN 0 AND 100),
    trust                INTEGER NOT NULL DEFAULT 0 CHECK (trust BETWEEN 0 AND 100),
    romantic_tension     INTEGER NOT NULL DEFAULT 0 CHECK (romantic_tension BETWEEN 0 AND 100),
    current_mood         VARCHAR(32) NOT NULL DEFAULT 'chill',
    internal_thought     TEXT NOT NULL DEFAULT '',
    relationship_stage   VARCHAR(32) NOT NULL DEFAULT 'stranger',
    unread_count               INTEGER NOT NULL DEFAULT 0,
    user_follows               BOOLEAN NOT NULL DEFAULT FALSE,
    persona_follows_back       BOOLEAN NOT NULL DEFAULT FALSE,
    is_close_friend            BOOLEAN NOT NULL DEFAULT FALSE,
    persona_added_close_friend BOOLEAN NOT NULL DEFAULT FALSE,
    is_rival                   BOOLEAN NOT NULL DEFAULT FALSE,
    dm_turns_count             INTEGER NOT NULL DEFAULT 0,
    dm_last_seen_at            TIMESTAMPTZ,
    last_interaction_at        TIMESTAMPTZ,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, persona_id)
);

CREATE TABLE IF NOT EXISTS post_likes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id             UUID NOT NULL,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liker_type          VARCHAR(10) NOT NULL CHECK (liker_type IN ('user', 'persona')),
    liker_persona_id    VARCHAR(32) REFERENCES personas(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. FEED: POSTS (PHOTOS, CAROUSELS, LOCATIONS, BOOKMARKS) & THREADED COMMENTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_type         VARCHAR(10) NOT NULL CHECK (author_type IN ('user', 'persona')),
    author_persona_id   VARCHAR(32) REFERENCES personas(id) ON DELETE SET NULL,
    body                TEXT NOT NULL,
    image_url           TEXT,
    media_urls          JSONB NOT NULL DEFAULT '[]'::jsonb,
    location_tag        VARCHAR(80),
    audience            VARCHAR(20) NOT NULL DEFAULT 'campus',
    liked_by_user       BOOLEAN NOT NULL DEFAULT FALSE,
    image_caption_ai    TEXT,
    likes_count         INTEGER NOT NULL DEFAULT 0,
    views_count         INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS saved_posts (
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id             UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id             UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_comment_id   UUID REFERENCES comments(id) ON DELETE CASCADE,
    author_type         VARCHAR(10) NOT NULL CHECK (author_type IN ('user', 'persona')),
    author_persona_id   VARCHAR(32) REFERENCES personas(id) ON DELETE SET NULL,
    body                TEXT NOT NULL,
    likes_count         INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at ASC);

-- -----------------------------------------------------------------------------
-- 6. INSTAGRAM STORIES (24H EXPIRY, SEEN STATE, LIKES, CLOSE FRIENDS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stories (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_type         VARCHAR(10) NOT NULL CHECK (author_type IN ('user', 'persona')),
    author_persona_id   VARCHAR(32) REFERENCES personas(id) ON DELETE CASCADE,
    media_url           TEXT NOT NULL,
    caption             TEXT NOT NULL DEFAULT '',
    audience            VARCHAR(20) NOT NULL DEFAULT 'campus',
    viewed_by_user      BOOLEAN NOT NULL DEFAULT FALSE,
    liked_by_user       BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stories_user_active ON stories(user_id, expires_at DESC);

-- -----------------------------------------------------------------------------
-- 7. INSTAGRAM DM NOTES (60-CHAR CAMPUS THOUGHTS ABOVE INBOX)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_notes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_type         VARCHAR(10) NOT NULL CHECK (author_type IN ('user', 'persona')),
    author_persona_id   VARCHAR(32) REFERENCES personas(id) ON DELETE CASCADE,
    body                VARCHAR(60) NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dm_notes_user ON dm_notes(user_id, expires_at DESC);

-- -----------------------------------------------------------------------------
-- 8. DIRECT MESSAGES (MULTI-BUBBLE + REAL MEDIA + REACTIONS + READ RECEIPTS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_messages (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona_id          VARCHAR(32) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    sender_type         VARCHAR(10) NOT NULL CHECK (sender_type IN ('user', 'persona', 'system')),
    message_type        VARCHAR(20) NOT NULL DEFAULT 'text'
                        CHECK (message_type IN ('text', 'image', 'audio', 'video', 'screenshot_alert', 'post_share', 'event_invite', 'story_reply', 'note_reply')),
    body                TEXT NOT NULL,
    media_url           TEXT,
    media_metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    reaction            VARCHAR(16),
    reply_to_message_id UUID REFERENCES dm_messages(id) ON DELETE SET NULL,
    read_at             TIMESTAMPTZ,
    bubble_group_id     UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dm_thread ON dm_messages(user_id, persona_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 9. EPISODIC & SEMANTIC MEMORY (PGVECTOR FOR RAG)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memories (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona_id          VARCHAR(32) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    fact                TEXT NOT NULL,
    category            VARCHAR(32) NOT NULL DEFAULT 'general',
    importance          INTEGER NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    source_type         VARCHAR(20) NOT NULL DEFAULT 'direct' CHECK (source_type IN ('direct', 'feed', 'gossip')),
    leaked_by_persona   VARCHAR(32) REFERENCES personas(id) ON DELETE SET NULL,
    embedding           VECTOR(768),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_user_persona ON memories(user_id, persona_id);
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING hnsw (embedding vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- 10. GOSSIP PROPAGATION LOG
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gossip_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    origin_persona_id   VARCHAR(32) NOT NULL REFERENCES personas(id),
    summary             TEXT NOT NULL,
    juiciness           INTEGER NOT NULL CHECK (juiciness BETWEEN 1 AND 10),
    reached_personas    JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 11. WORLD DIRECTOR: AUTONOMOUS EVENTS, CRISES & SCHEDULE CONFLICTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS world_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona_id          VARCHAR(32) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    event_type          VARCHAR(24) NOT NULL CHECK (event_type IN ('spontaneous_ping', 'emotional_hook', 'invite')),
    title               VARCHAR(140) NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    scheduled_day       INTEGER NOT NULL DEFAULT 1,
    scheduled_slot      VARCHAR(20) NOT NULL CHECK (scheduled_slot IN ('morning', 'afternoon', 'evening', 'late_night')),
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'declined', 'flaked', 'completed', 'expired')),
    reward_affinity     INTEGER NOT NULL DEFAULT 8,
    penalty_affinity    INTEGER NOT NULL DEFAULT -10,
    conflict_group      VARCHAR(40),
    dm_message_id       UUID REFERENCES dm_messages(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_world_events_user_slot ON world_events(user_id, scheduled_day, scheduled_slot, status);

-- -----------------------------------------------------------------------------
-- 12. ASYNC EVENT QUEUE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_type            VARCHAR(40) NOT NULL,
    payload             JSONB NOT NULL,
    run_at              TIMESTAMPTZ NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    attempts            INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_pending ON scheduled_jobs(run_at ASC) WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- 13. HELPER VIEW: TOP GOSSIP TARGETS FOR ANY PERSONA
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_gossip_routes AS
SELECT
    e.source_id,
    e.target_id,
    p_src.gossip_propensity,
    e.gossip_trust,
    ROUND((p_src.gossip_propensity * e.gossip_trust)::numeric, 3) AS leak_probability,
    e.relation_type
FROM persona_edges e
JOIN personas p_src ON p_src.id = e.source_id
WHERE e.gossip_trust >= 0.45
ORDER BY leak_probability DESC;
