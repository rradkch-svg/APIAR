# VELA — Campus Social Realism & Full Instagram Architecture Blueprint

> **Brand:** **Vela** (`vela`) — Autonomous Campus Social Network Simulator  
> **Core Mission:** Replace every scripted, premature-intimacy, fake-SVG, and robotic-TTS shortcut with a genuinely believable **Day-1 New College Student** Instagram experience (full Instagram feature parity **except Reels**), backed by real neural human voices (22 unique voices), photorealistic photography, realistic human message pacing, and 100% live-AI-ready generation pipelines.

---

## 1. Root-Cause Audit: Every Unreality & Scripted Flaw Eliminated

| # | Flaw Identified | Old Behavior (Unrealistic / Scripted) | New Vela Realism Rule |
|---|---|---|---|
| 1 | **Inflated Cold-Start Intimacy** | `onboarding/route.ts` had `STARTER_AFFINITY_MAP` putting Chloe at `42`, Leo at `40`, Bella at `38`, Theo at `34 + tension 22` before the user sent a single message. | **True Zero-Intimacy Cold Start:** All **22 personas** start at `affinity = 0`, `trust = 0`, `romantic_tension = 0`, `relationship_stage = 'stranger'`, `user_follows = false`, `persona_follows_back = false`, `is_close_friend = false`, `persona_added_close_friend = false`, `dm_turns_count = 0`. |
| 2 | **Cold-Start Rivalry Bug** | `computeRelationshipStage()` returned `"rival"` whenever `affinity <= 12`, which would turn all 22 Day-1 strangers into hostile rivals. | `is_rival` tracked explicitly in `user_persona_state`. Stages: `0–14 stranger`, `15–34 acquaintance`, `35–59 friend`, `60–79 close`, `80+` (or `tension >= 50 && affinity >= 45`) `crush`, and `rival` ONLY if `is_rival = true` after active conflict. |
| 3 | **Premature Bella Golden-Hour Invite** | Onboarding immediately invoked `generateWorldDirectorEvents({ triggerConflictingInvites: true })` and scheduled 2 instant warm welcome DMs (`chloe`, `bella`), so total stranger Bella immediately invited you to a golden-hour matcha shoot. | **ZERO forced welcomes or invites at onboarding.** You join campus like a real new student (0 followers, 0 following). Campus posts, Stories, and Notes exist independently of you. Optional single low-key RA orientation note (`nina`) only if you browse or follow — never intimate. |
| 4 | **Ungated World Director Events** | `director.ts` sent 3AM trauma/nightmare hooks to total strangers (zero affinity check!) and sent personal invites to anyone at `affinity >= 35` using static hardcoded lines. | Strict tiered gating:<br>• **Public Open Campus Events** (e.g. Student Union Mixer, Open Quad Tailgate, Rec Room Board-Game Night): requires `affinity >= 18` AND prior interaction.<br>• **Casual Friend Invites** (Coffee Run, Band Rehearsal, Duo Queue, Study Session): requires `affinity >= 40` AND `persona_follows_back = true`.<br>• **Personal / Close Invites** (Bella's Golden-Hour Shoot, Jade's Pilates, Theo's Rooftop, Maya's Midnight Studio): requires `affinity >= 60` AND `dm_turns_count >= 5`.<br>• **3AM Emotional Hooks:** requires `affinity >= 45` AND `trust >= 35`.<br>• **Spontaneous Pings:** requires `affinity >= 15` OR `persona_follows_back = true`. |
| 5 | **Instant Robotic DM Replies** | `deliver.ts` had 0ms "read" latency, ignored `persona.typing_style.delay_sec_range`, and spat out bubbles 220ms apart regardless of whether the persona was offline or a stranger. | Authentic multi-phase human delivery:<br>1. Message arrives as `Sent` (`read_at = NULL`).<br>2. Realistic **open & read latency** (longer for strangers / offline personas) -> updates `read_at` & emits SSE `dm:read` (`Seen`).<br>3. Optional emoji reaction (`dm:reaction`).<br>4. Authentic `typing:start` -> human typing speed (`~55–75ms/char` + natural thinking jitter) -> bubble -> natural inter-bubble pause (`900–2200ms`). |
| 6 | **Bizarre Robotic Audio Voices** | `VoiceNotePlayer.tsx` & `VideoNotePlayer.tsx` called browser `window.speechSynthesis`. | **Completely removed `window.speechSynthesis`.** `tts-engine.ts` maps **22 UNIQUE human neural voices** (11 female, 11 male) across ElevenLabs, OpenAI TTS, Gemini Native TTS, and free Microsoft Edge Neural TTS (`msedge-tts` generating real `.mp3` files served via `/api/v1/media/files/audio/*`). |
| 7 | **Fake SVG Scenes & Text-Only Bot Posts** | `mock-scene/route.ts` drew monochrome SVGs; `createAutonomousBotPost()` never attached photos, making bot posts grey text boxes. | **Zero SVGs.** `image-engine.ts` powers photorealistic candid iPhone photography for **Feed Posts, Carousels, Stories, and DM Media** via Gemini Imagen / Nano Banana (with face-reference preservation from `public/avatars/{id}.jpg`), OpenAI-compatible Image API (`gpt-image-1` / `grok-2-image` / Flux), and 30 curated local real `.jpg` campus photographs as zero-key fallback. |
| 8 | **Scripted Prompts & Immersion Leaks** | `prompts.ts` told all personas `"Speak like a real friend"` at `affinity = 0`, leaked `persona.secrets` at `trust = 0`, and misattributed bot posts to the user; `mock.ts` echoed internal `reason` prompts verbatim as bubble #2! | Stage-aware social distance prompt directives (`stranger` personas are realistically dry/guarded/polite, NEVER calling you "bestie" or oversharing). Secrets gated behind `trust >= 45`. Fixed post-author attribution in feed comments. Eliminated `reason` echo bug in `mock.ts`. |
| 9 | **Fake Instagram Shell** | Profile hardcoded `22 followers / 22 following` + verified badge; Stories rail leaked private `internal_thought`; no user commenting/replying, no Bookmarks, no DM Notes, no Carousels, no DM photos/reactions/read receipts. | Complete Instagram parity (minus Reels) — see Section 2 below. |

---

## 2. Full Instagram Feature Parity Architecture (No Reels)

### 2.1 Database Tables & Columns (`db/schema.sql` + `src/lib/db/migrate.ts`)
- **`user_persona_state`**: `affinity DEFAULT 0`, `trust DEFAULT 0`, `romantic_tension DEFAULT 0`, `relationship_stage DEFAULT 'stranger'`, `user_follows`, `persona_follows_back`, `is_close_friend`, `persona_added_close_friend`, `is_rival`, `dm_turns_count`, `dm_last_seen_at`.
- **`posts`**: `image_url`, `media_urls JSONB` (multi-photo Carousels), `location_tag`, `audience ('campus' | 'close_friends')`, `liked_by_user`.
- **`post_likes`**: real relational likes from both `user` and `persona` (powers authentic `"Liked by @handle and N others"` and real Activity notifications).
- **`saved_posts`**: user Bookmarks + Profile **Saved** tab.
- **`comments`** + **`comment_likes`**: user can comment & reply (`parent_comment_id`) on ANY post, like comments, and receive authentic persona replies back.
- **`stories`**: real 24h photo Stories (`author_type`, `author_persona_id`, `media_url`, `caption`, `location_tag`, `audience`, `viewed_by_user`, `liked_by_user`, `expires_at`).
- **`dm_notes`**: 60-character 24h thought bubbles above the DM inbox (`author_type`, `author_persona_id`, `body`, `expires_at`).
- **`dm_messages`**: `message_type IN ('text','image','audio','video','screenshot_alert','post_share','event_invite','story_reply','note_reply')`, `media_url`, `media_metadata`, `reaction`, `reply_to_message_id`, `read_at`.

### 2.2 API Surface
- **Feed & Posts:** `GET /api/v1/feed?scope=all|following|saved|persona&persona_id=...`, `POST /api/v1/posts` (single or carousel + location + audience + Vision analysis), `POST /api/v1/posts/[id]/like` (true toggle), `POST /api/v1/posts/[id]/save`, `POST /api/v1/posts/[id]/share` (share post into a persona's DM), `POST /api/v1/posts/[id]/comments` (user comments & replies triggering realistic bot replies!).
- **Stories:** `GET/POST /api/v1/stories`, `POST /api/v1/stories/[id]/interact` (`view` | `like` | `reply` -> sends `story_reply` DM + triggers persona reaction).
- **DM Notes:** `GET/POST/DELETE /api/v1/notes`, `POST /api/v1/notes/[id]/reply` (sends `note_reply` DM + triggers persona reaction).
- **Social Graph & Follow System:** `POST /api/v1/personas/[id]/follow` (toggle follow / close friend; schedules realistic organic follow-back evaluation), `GET /api/v1/me` (real dynamic `followers_count` & `following_count` starting at `0 / 0`).
- **DMs:** `POST /api/v1/dms/[persona_id]/messages` (supports `text`, user `image` upload with Vision analysis, `reply_to_message_id`, `screenshot_alert`), `POST /api/v1/dms/[persona_id]/messages/[message_id]/react`, `POST /api/v1/dms/[persona_id]/messages/[message_id]/view`.
- **Media:** `GET /api/v1/media/files/[...path]` (streams `.vela-media/{audio,images,uploads}/*` reliably in `next dev` & `next start`).

### 2.3 Visual Design System (Strict iOS Dark Mode — Zero AI Slop)
- Brand: **Vela** with minimalist geometric 4-point star/spark logo (`VelaLogo.tsx`, `public/icon.svg`).
- Palette: `#0D0E12` background, `#18191E` grouped surfaces/inputs, `#262930` secondary pills, `#262626` persona DM bubbles, `#FFFFFF` primary text, `#8E8E93` secondary text/12px timestamps, `1px solid rgba(255,255,255,0.08)` dividers, `#5E5CE6` sole primary accent.
- Only allowed gradients: IG Story ring (`#FEDA75 → #D62976 → #962FBF`) and Close Friends green ring (`#30D158`).
- Bottom Navigation: 5 clean icons (`Home`, `Search`, `PlusSquare`, `Heart`, user avatar) with zero text labels underneath.

---

## 3. Photorealistic Photo Engine & 22-Voice Real Human Audio Engine

### 3.1 Photorealistic Image Engine (`src/lib/media/image-engine.ts`)
- **Live Mode 1 (`IMAGE_PROVIDER=gemini`):** Uses `GEMINI_API_KEY` with Gemini Imagen (`imagen-3.0-generate-002`) OR Gemini Native Image (`gemini-2.5-flash-image` / `gemini-3.1-flash-image` with `public/avatars/{id}.jpg` passed as inline portrait reference for exact face consistency on selfies & persona feed photos!).
- **Live Mode 2 (`IMAGE_PROVIDER=openai_compatible`):** Uses `IMAGE_API_KEY` + `IMAGE_BASE_URL` (OpenAI `gpt-image-1`, xAI `grok-2-image`, Together/Flux).
- **Fallback Mode (`curated`):** Semantically matches against 30 verified local high-res campus lifestyle `.jpg` photos in `public/photos/*.jpg` (and real portrait `.jpg`s in `public/avatars/*.jpg` for selfies). **Zero SVGs ever.**

### 3.2 Real 22-Voice Neural TTS Engine (`src/lib/media/tts-engine.ts`)
- **22 distinct voices** mapped 1-to-1 across all 22 personas (`11 female`, `11 male`) with persona-specific cadence/pitch:
  1. **ElevenLabs** (`TTS_PROVIDER=elevenlabs` + `ELEVENLABS_API_KEY`) — studio ultra-human voices.
  2. **OpenAI TTS** (`TTS_PROVIDER=openai` + `TTS_API_KEY`, `gpt-4o-mini-tts` with vocal acting instructions).
  3. **Gemini Native TTS** (`TTS_PROVIDER=gemini` + `GEMINI_API_KEY`, 22 distinct Gemini prebuilt studio voices).
  4. **Microsoft Edge Neural TTS** (`msedge-tts`, default zero-key fallback) — 22 distinct real Microsoft Neural voices generating genuine `.mp3` files cached in `.vela-media/audio/`.

---

## 4. Complete `.env` API Keys Matrix (100% Live AI Wake-Up Checklist)

Paste keys in `.env` (or directly in **Settings -> AI Engine**) to switch EVERY single subsystem from fallback to 100% live generative AI:

### Option A — Simplest All-In-One (Just ONE Key!)
```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_google_ai_studio_key_here
GEMINI_ROLEPLAY_MODEL=gemini-2.5-flash
GEMINI_FAST_MODEL=gemini-2.5-flash-lite
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
IMAGE_PROVIDER=gemini
IMAGE_MODEL=gemini-2.5-flash-image
TTS_PROVIDER=gemini
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
```
> That **single `GEMINI_API_KEY`** activates: Live LLM DMs + Comments + Bot Posts + Stories + DM Notes + World Director Invites/Hooks + Vision (User Post & DM Photos) + 768d pgvector RAG Embeddings + Photorealistic AI Photos (with face-locked selfies!) + 22-Voice Native Neural TTS!

### Option B — Mix & Match (e.g., Grok / OpenAI / NVIDIA NIM + ElevenLabs + Flux/Imagen)
```env
# 1. Text & Vision Brain (Grok / OpenAI / OpenRouter / NVIDIA NIM)
LLM_PROVIDER=openai_compatible
LLM_BASE_URL=https://api.x.ai/v1
LLM_API_KEY=your_llm_api_key_here
LLM_ROLEPLAY_MODEL=grok-3-mini
LLM_FAST_MODEL=grok-3-mini-fast

# 2. Photorealistic Image Generation (OpenAI gpt-image-1 / xAI grok-2-image / Gemini)
IMAGE_PROVIDER=openai_compatible
IMAGE_BASE_URL=https://api.x.ai/v1
IMAGE_API_KEY=your_image_api_key_here
IMAGE_MODEL=grok-2-image

# 3. Ultra-Realistic Voices (ElevenLabs or OpenAI TTS; leave blank for free 22-voice Edge Neural!)
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_elevenlabs_key_here
ELEVENLABS_MODEL=eleven_flash_v2_5

# 4. Optional Video Note Generator Webhook (e.g., Kling / Runway / Veo proxy)
MEDIA_VIDEO_ENDPOINT=
```

---

## 5. Mandatory 5:00 AM "Unreality Audit" Checklist (`docs/UNREALITY_AUDIT.md`)

At **05:00 AM (-03:00)**, perform a ruthless fresh-student audit from scratch:
1. Reset world (`reset_world: true`) and complete Onboarding as a brand-new student.
2. Verify **0 followers / 0 following** on Profile, **0/0/0** (`affinity/trust/tension`) on all 22 personas, and **NO** unsolicited Bella Golden-Hour invite or overly familiar welcome spam.
3. DM a guarded stranger (`cole` or `sofia`) and a polite stranger (`leo` or `nina`): verify realistic read (`Seen`) + typing latency, realistic stranger boundaries (no "bestie", no instant flirting, no Tier 1+ media leaks).
4. Inspect Feed & Stories in headless browser: verify **100% real `.jpg` photography** (zero SVGs, zero broken images, zero console errors), Stories open/advance/reply cleanly, Carousels slide, double-tap heart works, User Comments & Bot Replies work, Bookmarks appear on Profile Saved tab, DM Notes work, and Voice Notes stream real distinct `.mp3` neural audio files.
5. Verify Settings clearly shows Live AI vs Fallback status for LLM, Vision, Embeddings, Image Engine, and 22-Voice TTS, and clean up any subtle unreality or visual bug before 6:00 AM.
