-- =============================================================================
-- AI SOCIAL NETWORK (CIRCLE / ORBIT / CHARM CLONE) — POSTGRESQL + PGVECTOR DDL
-- =============================================================================
-- Extensions required
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- -----------------------------------------------------------------------------
-- 1. USERS & AUTH
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    handle          VARCHAR(32) UNIQUE NOT NULL,
    display_name    VARCHAR(80) NOT NULL,
    bio             TEXT DEFAULT '',
    context_tag     VARCHAR(40) DEFAULT 'universitario',
    avatar_url      TEXT,
    energy          INTEGER NOT NULL DEFAULT 20,
    max_energy      INTEGER NOT NULL DEFAULT 20,
    energy_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    plan_tier       VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro')),
    gold_balance    INTEGER NOT NULL DEFAULT 0,
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. AI PERSONAS (NODES IN THE SOCIAL GRAPH)
-- -----------------------------------------------------------------------------
CREATE TABLE personas (
    id                  VARCHAR(32) PRIMARY KEY, -- e.g. 'duda', 'bia', 'theo'
    display_name        VARCHAR(80) NOT NULL,
    handle              VARCHAR(32) UNIQUE NOT NULL,
    clique              VARCHAR(40) NOT NULL,    -- campus, influencers, drama, arts, tech
    archetype           VARCHAR(80) NOT NULL,
    avatar_url          TEXT,
    accent_color        VARCHAR(16) NOT NULL,
    age                 INTEGER NOT NULL,
    bio                 TEXT NOT NULL,
    personality_prompt  TEXT NOT NULL,
    typing_style        JSONB NOT NULL,          -- {lowercase, emoji_rate, avg_bubbles, slang, delay_sec_range}
    secrets             JSONB NOT NULL DEFAULT '[]'::jsonb,
    triggers            JSONB NOT NULL DEFAULT '{}'::jsonb, -- topics that raise/lower mood
    gossip_propensity   REAL NOT NULL DEFAULT 0.5 CHECK (gossip_propensity BETWEEN 0 AND 1),
    activity_schedule   JSONB NOT NULL DEFAULT '{}'::jsonb, -- peak hours in user timezone
    is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

-- -----------------------------------------------------------------------------
-- 3. DIRECTED WEIGHTED SOCIAL GRAPH (BOT <-> BOT EDGES)
--    Asymmetric: A->B can differ from B->A (e.g., unrequited crush, one-sided rivalry)
-- -----------------------------------------------------------------------------
CREATE TABLE persona_edges (
    source_id           VARCHAR(32) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    target_id           VARCHAR(32) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    relation_type       VARCHAR(32) NOT NULL, -- bestie, rival, ex, crush, frenemy, roommate, bandmate, acquaintance
    affinity            INTEGER NOT NULL DEFAULT 0 CHECK (affinity BETWEEN -100 AND 100),
    friction            REAL NOT NULL DEFAULT 0.2 CHECK (friction BETWEEN 0 AND 1),       -- prob of arguing in comments
    gossip_trust        REAL NOT NULL DEFAULT 0.3 CHECK (gossip_trust BETWEEN 0 AND 1),   -- prob of leaking user secrets
    shared_lore         TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (source_id, target_id),
    CHECK (source_id <> target_id)
);

CREATE INDEX idx_persona_edges_source ON persona_edges(source_id);
CREATE INDEX idx_persona_edges_target ON persona_edges(target_id);
CREATE INDEX idx_persona_edges_gossip ON persona_edges(source_id, gossip_trust DESC);

-- -----------------------------------------------------------------------------
-- 4. USER <-> PERSONA DYNAMIC STATE (DYNAMIC USER EDGES)
-- -----------------------------------------------------------------------------
CREATE TABLE user_persona_state (
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona_id          VARCHAR(32) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    affinity            INTEGER NOT NULL DEFAULT 25 CHECK (affinity BETWEEN 0 AND 100),
    trust               INTEGER NOT NULL DEFAULT 20 CHECK (trust BETWEEN 0 AND 100),
    romantic_tension    INTEGER NOT NULL DEFAULT 0 CHECK (romantic_tension BETWEEN 0 AND 100),
    current_mood        VARCHAR(32) NOT NULL DEFAULT 'neutral', -- hyped, annoyed, flirty, suspicious, chill, jealous
    internal_thought    TEXT NOT NULL DEFAULT '',
    relationship_stage  VARCHAR(32) NOT NULL DEFAULT 'stranger', -- stranger, acquaintance, friend, close, crush, rival
    unread_count        INTEGER NOT NULL DEFAULT 0,
    last_interaction_at TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, persona_id)
);

-- -----------------------------------------------------------------------------
-- 5. FEED: POSTS & THREADED COMMENTS
-- -----------------------------------------------------------------------------
CREATE TABLE posts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- owner of this simulation world
    author_type         VARCHAR(10) NOT NULL CHECK (author_type IN ('user', 'persona')),
    author_persona_id   VARCHAR(32) REFERENCES personas(id) ON DELETE SET NULL,
    body                TEXT NOT NULL,
    image_url           TEXT,
    image_caption_ai    TEXT, -- vision model description of user-uploaded image
    likes_count         INTEGER NOT NULL DEFAULT 0,
    views_count         INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_posts_user_created ON posts(user_id, created_at DESC);

CREATE TABLE comments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id             UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_comment_id   UUID REFERENCES comments(id) ON DELETE CASCADE, -- NULL = top-level; non-NULL = bot-to-bot reply
    author_type         VARCHAR(10) NOT NULL CHECK (author_type IN ('user', 'persona')),
    author_persona_id   VARCHAR(32) REFERENCES personas(id) ON DELETE SET NULL,
    body                TEXT NOT NULL,
    likes_count         INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON comments(post_id, created_at ASC);

-- -----------------------------------------------------------------------------
-- 6. DIRECT MESSAGES (MULTI-BUBBLE + SCREENSHOT EVENTS)
-- -----------------------------------------------------------------------------
CREATE TABLE dm_messages (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona_id          VARCHAR(32) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    sender_type         VARCHAR(10) NOT NULL CHECK (sender_type IN ('user', 'persona', 'system')),
    message_type        VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'screenshot_alert', 'post_share')),
    body                TEXT NOT NULL,
    bubble_group_id     UUID, -- groups 2-4 rapid consecutive bubbles from the same LLM turn
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dm_thread ON dm_messages(user_id, persona_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 7. EPISODIC & SEMANTIC MEMORY (PGVECTOR FOR RAG)
-- -----------------------------------------------------------------------------
CREATE TABLE memories (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona_id          VARCHAR(32) NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    fact                TEXT NOT NULL,
    category            VARCHAR(32) NOT NULL DEFAULT 'general', -- pet, location, taste, secret, drama, promise
    importance          INTEGER NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    source_type         VARCHAR(20) NOT NULL DEFAULT 'direct' CHECK (source_type IN ('direct', 'feed', 'gossip')),
    leaked_by_persona   VARCHAR(32) REFERENCES personas(id) ON DELETE SET NULL,
    embedding           VECTOR(768), -- matches text-embedding-004 / gemini-embedding-001 (adjust dim if needed)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memories_user_persona ON memories(user_id, persona_id);
CREATE INDEX idx_memories_embedding ON memories USING hnsw (embedding vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- 8. GOSSIP PROPAGATION LOG (GRAPH TRAVERSAL TRACKING)
-- -----------------------------------------------------------------------------
CREATE TABLE gossip_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    origin_persona_id   VARCHAR(32) NOT NULL REFERENCES personas(id),
    summary             TEXT NOT NULL,
    juiciness           INTEGER NOT NULL CHECK (juiciness BETWEEN 1 AND 10),
    reached_personas    JSONB NOT NULL DEFAULT '[]'::jsonb, -- ['bia', 'jade', 'theo']
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 9. ASYNC EVENT QUEUE (REALISTIC DELAYS & PROACTIVE TRIGGERS)
-- -----------------------------------------------------------------------------
CREATE TABLE scheduled_jobs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_type            VARCHAR(40) NOT NULL, -- 'feed_comment', 'comment_reply', 'gossip_leak', 'proactive_dm', 'bot_post', 'memory_extract'
    payload             JSONB NOT NULL,
    run_at              TIMESTAMPTZ NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
    attempts            INTEGER NOT NULL DEFAULT 0,
    last_error          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_pending ON scheduled_jobs(run_at ASC) WHERE status = 'pending';

-- -----------------------------------------------------------------------------
-- 10. HELPER VIEW: TOP GOSSIP TARGETS FOR ANY PERSONA
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
