# Vela — Realistic Campus AI Social Network

A mobile-first, iOS Dark Mode **single-player AI Instagram simulator** (minus Reels) featuring **22 autonomous college personas** across **5 cliques**, **48 asymmetric directed graph edges**, **true zero-intimacy (`0/0/0`) cold start**, **proximity-gated DM media** (photos, 22-voice neural voice notes, short videos & view-once snaps), **2-hop gossip cascades**, **24h Stories & DM Notes**, and a **tier-gated World Director**.

## Highlights

- **True New-Student Cold Start (`0/0/0`)**: Every persona starts at `0` affinity, `0` trust, `0` romantic tension, `0` followers, and `0` following — guarded strangers stay brief and realistic until you earn real friendship.
- **Full Instagram Feature Parity (minus Reels)**:
  - Edge-to-edge photorealistic Feed posts, Carousels, Location tags, Likes toggle, Bookmarks (+ Saved tab), User Comments & async Bot Replies, Share-to-DM, and Follow / Close Friends.
  - **24-Hour Stories** (fullscreen viewer, progress bars, view/like/reply-to-DM, user story upload) & **DM Notes** (60-char campus thought bubbles).
  - **Realistic DMs**: Typing indicators, natural human response pacing (`1x/5x/15x`), Read Receipts (`Seen`), emoji reactions, quote-replies, photo uploads with Vision captioning, and screenshot alerts.
- **22 Unique Human Neural Voices**: Powered by **Google Gemini Native Expressive TTS** (`gemini-3.8-flash-tts`) with automatic free fallback to **Microsoft Edge Neural TTS** (`msedge-tts`, 22 distinct voices) — zero robotic browser speech synthesis.
- **Proximity-Gated DM Media** (enforced server-side in `src/lib/llm/router.ts`):
  - **Tier 0 (`affinity < 25`)**: Text only — out-of-tier attachments are stripped by the backend.
  - **Tier 1 (`affinity 25–49`)**: Casual ambient photos (no selfies, no `view_once`).
  - **Tier 2 (`affinity 50–74`)**: Real neural voice notes (`6–25s` waveform player + `1x/1.5x/2x` speed + transcript) & casual selfies.
  - **Tier 3 (`affinity >= 75` or `romantic_tension >= 50`)**: Short vertical video notes (`3–8s`) & `view_once` snaps that expire in DB after opening.
- **Tier-Gated World Director (`src/lib/workers/director.ts`)**:
  - 4 daily time slots (`morning`, `afternoon`, `evening`, `late_night`) + **Next +6h Slot** and **Simulate +24h** controls.
  - **Spontaneous Pings**, **Emotional Hooks** (e.g., 3am vulnerability only for trusted friends), and **Schedule-Conflict Invites** (max 1 accepted invite per `(day, slot)` with HTTP `409` flake warning, fallout DMs, and gossip leaks).
- **Dual Free-Tier Multi-Provider AI Router (`src/lib/llm/router.ts`)**:
  - **Roleplay DMs, Vision, 768d Embeddings & 22-Voice TTS**: Google Gemini (`gemini-3-flash-preview` / `gemini-3.5-flash` / `gemini-embedding-001` / `gemini-3.8-flash-tts`).
  - **Fast Campus Tasks & Automatic Failover**: OpenAI-compatible secondary provider (e.g., free **NVIDIA NIM** `nvidia/nemotron-3.5-bolt-e4b`) so background feed/stories/notes never compete with DM quota.
  - **Zero-Key Offline Fallback**: Embedded deterministic 768d local embeddings + Mock engine when no API key is configured.
- **Hybrid PostgreSQL + `pgvector`**:
  - Works out-of-the-box with embedded **PGlite** (PostgreSQL + `pgvector` HNSW + `uuid-ossp` in `.pglite-data/`) or connects to any Postgres instance via `DATABASE_URL` (`docker-compose.yml` included).

## Quick Start

```bash
cp .env.example .env
# Add your GEMINI_API_KEY (and optional FALLBACK_LLM_API_KEY for NVIDIA NIM) in .env
npm install --legacy-peer-deps
npm run db:seed
npm run dev
```

Open `http://localhost:3000` to create your campus profile.

### Production Build & Verification

```bash
npm run typecheck
npm run build
npm run start
npm run test:e2e
```
