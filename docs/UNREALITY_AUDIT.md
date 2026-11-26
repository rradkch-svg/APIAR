# VELA — 05:00 AM Unreality Audit & Fixes Report

> **Audit Timestamp:** 2026-11-26 05:00 AM (`-03:00`)  
> **Method:** Live server stress test against `http://localhost:3000` (fresh cold-start account, idle `+6h`/`+24h` simulation at `0` affinity, 8 multi-persona stranger DM probes, 4-persona real neural MP3 voice check, settings partial-patch persistence test) + full UI/component review + live headless mobile browser audit (`430x900`).

---

## 1. Unreality Findings & Fixes Applied

### Finding #1 — AI Prompt Text Leaking Underneath DM Photos & Video Notes *(CRITICAL IMMERSION BREAK)*
- **Where:** `src/components/PhotoMessageCard.tsx:112,132,158` and `src/components/VideoNotePlayer.tsx:110`
- **What felt unreal:** Whenever a persona sent a DM photo or short video note, the UI printed the raw AI image prompt (`meta.visual_prompt`, e.g., *"Iced coffee cup and open notebook on a sunny wooden quad table..."* or *"Candid late-night mirror snap from Theo..."*) as a subtitle beneath the photo or overlaid on the video! Real Instagram DM photos never print prompt descriptions.
- **Fix:** Removed the raw prompt subtitle from `PhotoMessageCard.tsx` (rendering clean full-bleed Instagram DM photo bubbles and full-bleed modals) and removed the prompt caption overlay from `VideoNotePlayer.tsx` (keeping only clean duration badge, real audio mute/unmute toggle, and slim progress bar).

### Finding #2 — Third-Person RPG Narrator Description Inside DM Event Invite Cards
- **Where:** `src/components/EventInviteCard.tsx:119`
- **What felt unreal:** Inside a DM bubble sent by a friend, the card showed third-person RPG narration (*"Gabe wants you at his band's rehearsal..."*) right beneath his first-person message (*"yo our band is rehearsing..."*).
- **Fix:** Removed the third-person narrator `description` line from `EventInviteCard.tsx`, leaving the authentic iOS Calendar/Plans header (`Day X · Evening`), event title, first-person invite line, and `Accept / Decline` pills.

### Finding #3 — Duplicate Photos Between Seeded Feed Posts & Active Stories
- **Where:** `src/lib/media/image-engine.ts` + `src/lib/workers/lazy-feed.ts` + `src/lib/llm/mock.ts`
- **Evidence (05:01 AM probe):** `@lukesato` posted `/photos/dual-monitor-night.jpg` on BOTH the Feed AND his Story, and `@camilareyes` + `@ninapark` both received `/photos/library-stacks.jpg` in their Stories. Additionally, `mockBotStory` recycled `mockBotPost` captions word-for-word.
- **Fix:** Added `excludeUrls?: string[]` deduplication across `generatePhotorealisticImage` / `pickRealisticFallbackPhoto` and passed all currently visible feed + story URLs when seeding posts/stories so every Feed post and active Story shows a **unique photograph**. Added dedicated persona-authentic Story captions in `mockBotStory` completely separate from Feed posts.

### Finding #4 — Out-of-Character & Non-Sequitor Stranger Replies in Fallback Mode
- **Where:** `src/lib/llm/mock.ts` + `src/lib/llm/router.ts`
- **Evidence (05:01 AM probe):**
  1. `jade` (aesthetic pilates/matcha influencer) replied `"yo? who's this"` to `"hi!"` (out-of-character frat-bro tone).
  2. `leo` asked `"are you new around campus?"` on Turn 2 right after welcoming the user on Turn 1 (repeated onboarding question).
  3. `nina` replied `"campus gets pretty hectic this week"` when explicitly asked `"any library tips?"` (ignored the question).
  4. `bella` replied `"first week on campus is always a lot"` when told `"saw your post on the feed"` (non-sequitur).
- **Fix:** Passed `historyLength` into `mockDmResponse`, mapped persona-accurate guarded openers for every guarded student (`jade`, `sofia`, `helena`, `camila`, `maya`, `cole`, `victor`, `ezra`), prevented duplicate `"are you new?"` questions on Turn 2+, and added natural college topic comprehension (`library/study`, `coffee/matcha`, `feed/post`, `major/classes`) so even before API keys are pasted, replies stay grounded and coherent.

### Finding #5 — Partial Settings Update Bug Wiping `llmProvider` *(Caught in Phase 1 Browser Screenshot)*
- **Where:** `src/lib/config/runtime.ts:115-145`
- **What broke:** Sending a partial `POST /api/v1/dev/settings` payload (e.g., `{ boost_persona: ... }` or `{ speed_multiplier: 1 }`) spread `undefined` fields over `RuntimeConfig`, clearing `llmProvider` and making neither provider button highlight in `/settings`.
- **Fix:** Stripped all `undefined` entries before spreading in `updateRuntimeConfig()`. Verified via live 05:01 AM probe: `llm_provider: 'gemini'`, `image_mode`, and `tts_mode` remain 100% intact after every partial patch.

### Finding #6 — Mobile Visual Polish (Story Viewer Fold, Settings Wrapping, iOS Toast Placement)
- **Where:** `src/app/feed/page.tsx`, `src/app/settings/page.tsx`, `src/components/RealtimeProvider.tsx`
- **Fix:** Capped Story Viewer media frame at `max-h-[74dvh]` so captions & reply bar never fall below the fold on short phones; shortened Settings row labels (`Photo Engine`, `Voice Engine (TTS)`) with single-line status text; moved notification banner to `top-3` so it never overlaps Profile counters.

---

## 2. Passed Realism Invariants Verified at 05:00 AM
- **True 0/0/0 Cold Start:** All 22 personas start at `affinity = 0`, `trust = 0`, `romantic_tension = 0`, `relationship_stage = 'stranger'`, `0 followers`, `0 following`.
- **Zero Premature Invites or Welcome Spam:** Even after advancing **`+6h` AND `+24h`** while idle at `0` affinity, `0` invites, `0` emotional hooks, and `0` unsolicited stranger DMs fired — while 2 fresh autonomous campus photo posts still appeared organically on the Feed.
- **22 Unique Real Human Neural Voices (Zero Robotic Browser Speech):** Verified live MP3 generation & HTTP 200 streaming across distinct voices (`@chloe` `en-US-JennyNeural` 24KB, `@theo` `en-US-SteffanNeural` 26KB, `@sofia` `en-GB-SoniaNeural` 26KB, `@gabe` `en-US-BrianNeural` 21KB, `@maya` `en-US-AvaMultilingualNeural` 51KB). Zero `window.speechSynthesis` calls exist in `src/`.
- **100% Photorealistic Media:** Zero SVGs anywhere in Feed posts, Stories, Avatars, or DM photos.
- **Human Pacing & Full Instagram Parity:** Authentic `Sent` -> read delay -> `Seen` -> typing indicator -> bubble cadence; Stories (view/like/reply/post), DM Notes, Carousels, Location tags, User Comments & Bot Replies, Likes toggle, Bookmarks + Saved tab, Share-to-DM, Follow/Close Friends, and DM Emoji Reactions all verified end-to-end.
