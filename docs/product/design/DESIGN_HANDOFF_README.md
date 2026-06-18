# Handoff: Axessplayer adaptive micro-series platform

## Overview
Axessplayer is an adaptive vertical micro-series platform. One canonical episode is pre-rendered (the "story spine"); the platform personalizes the delta per viewer: hook, recap, POV, branch, language/dub, accessibility layer, product placement, unlock offer, poster, and a post-episode character message. The moat is the combination of the **variant substrate + story graph + rights ledger + viewer decision engine + brand placement plane + accessibility factory**, not the AI video itself.

This bundle delivers the design for **four surfaces**:
1. **Viewer app** (mobile-first, plus a desktop web watch view)
2. **Creator Studio** (desktop web)
3. **Admin / Operator console** (desktop web)
4. Supporting brand collateral (guidelines, pitch deck, marketing site) for reference

## About the design files
The files in this bundle are **design references created in HTML** (Design Components that open directly in a browser). They are prototypes showing intended look and behavior, **not production code to copy directly**. The task is to **recreate these designs in the target codebase's environment** (the planned stack references React apps `apps/mobile`, `apps/web`, `apps/studio`, `apps/admin` with `services/*` on Postgres) using its established patterns and libraries. Where the prototype embeds logic (the recap assembler), treat it as a **reference implementation** to port to the real `viewer_state + decision_log + events` schema, not as shippable code.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, and interaction patterns are intended to be matched. Recreate the UI pixel-accurately using the codebase's component library. Charts in the prototypes are CSS-drawn approximations; swap for the codebase's charting library while keeping the visual language (rose series, bands not points for counterfactuals).

## Design tokens

### Color
- Ink / app background: `#0B0B0D` (deepest), `#08080A` (board), surfaces `#15151b`, cards `#16161c`
- Borders: `#1f1f25`, `#20202a`, `#26262d`; hairline on cards `#1a1a20`
- Rail / topbar background: `#0E0E12`
- Primary text `#FAFAF8`; secondary `#C9C9CF`; muted `#9A9AA0`; faint `#6B6B72`; faintest `#54545C`
- **Electric Rose (primary accent)** `#FF2E6E`; soft rose `#FF8FB4`; deep rose `#cf1d57`
- **Gold (premium/credits)** `#E8B54B`
- Semantic: success `#1F8A5B`, info/blue `#5aa6ff`, danger `#ff5f57`, warning `#E8B54B`
- Rose tints used for fills: `rgba(255,46,110,0.08–0.16)`; gold tint `rgba(232,181,75,0.14–0.16)`

### Typography
- Display / headings: **Outfit**, weight 600, letter-spacing -0.035em (large) to -0.02em (small); lowercase wordmark `axessplayer` with `player` in rose
- Body / UI: **Inter**, 400/500/600
- Mono labels, codes, data tags: **JetBrains Mono**, uppercase, letter-spacing 0.1–0.18em, sizes 9–13px
- Heading scale (desktop consoles): h1 30px, section title 16px, KPI number 22–30px
- Mobile: screen titles 20–32px, body 13–15px, captions 11–12px

### Spacing, radius, shadow
- Card radius 13–16px; pill 999px; phone screen radius 46px (bezel 9px solid `#1b1b21`)
- Panel padding 18–22px; page padding 30px 36px (consoles)
- Card shadow (phones): `0 40px 80px -30px rgba(0,0,0,0.9)`
- Focus accent ring uses rose; toggles are 38–42px pills with rose "on" track

### Iconography
- Inline stroke SVGs, `stroke-width` 1.8–1.9, `currentColor`. No emojis anywhere. No em dashes in any copy (use middot, comma, or sentence breaks).

## Surfaces, screens & behavior

### 1. Viewer app (`Axessplayer App.dc.html`)
Mobile screens are 320px-wide device frames; a desktop web watch view is also included. Screens (grouped):
- **Onboarding**: welcome, cold-open calibration ("How should it feel?" tap choices, 3-step progress), "your cut is ready"
- **Discover**: home feed (continue-watching hero, trending rail, credits pill, bottom tab bar), series detail (poster hero, episodes, endings count, CC/AD/SIGN/language badges, locked episodes)
- **Watch**: vertical player (POV pill, right action rail: like/cuts/AD/share, localized caption, progress), choice/branch overlay (countdown ring, two choices), accessibility drawer (captions, audio description, sign-language PiP, 40+ languages)
- **Monetize**: premium variant unlock sheet (alt ending / his POV / intensity+, prices in credits), wallet (balance, Earn rewarded ad, Buy packs, Subscribe)
- **Account**: profile (stats, continue watching, settings rows), desktop web watch view (nav, hero, trending rail)
- **Auth**: sign in (Apple/Google/email), create profile + channel interest picks
- **Search & channels**: search + channel grid (Telenovela, Crime, Thriller, Reality, Cooking, Podcasts, Education, Children, Drama), channel detail
- **Library & favorites**: saved/downloads/history grid, My Favorites (shows + followed characters)
- **Community**: character follow feed (Instagram-like: stories, verified posts, like/comment), comments thread on a show (composer, replies, spoiler items)
- **Invite & rewards**: referral code, share, 200-credit reward, milestone progress
- **Previously in your cut (recap engine)**: see "Recap engine" below
- **Delight layer**: character inbox (in-character messages, voice note, secret-clue purchase, "choose what I do next" with age-gate guardrails), dynamic posters per viewer (served poster + candidate set tagged by emotion, CTR-tracked, accessibility-first variant always present), branch-as-quest (unlock via invite / watch-ad-for-clue / spend credits, plus a community-goal progress bar)

### 2. Creator Studio (`Axessplayer Studio.dc.html`)
Desktop web app, left rail + topbar (Simple/Pro toggle, generation-credits meter). Views, switched by `[data-nav]` -> `[data-panel]`:
- Dashboard (views/watch-time/revenue/payout KPIs, revenue-by-source bars, next-best-actions, top-series table)
- Create with AI (prompt-to-series showrunner with pipeline stages + cost gate; upload-master dropzone; footage adapter)
- Content library (CMS table: status chips, accessibility coverage meter, C2PA, bulk actions, filters)
- Series editor (episode list, details incl. Series/Podcast/Film format, accessibility + language fan-out with Process action)
- Branch editor (beat graph, choices, alternate endings + premium cuts priced in credits, canon-valid check; Pro reveals full graph)
- Channels (create + branded channel page, followers, channel analytics, brand deals, series grid)
- Monetization (per-series pricing, reward mechanism, transparent 70/30 by source)
- Analytics (beat retention curve, ending-lift as bands, paywall funnel, demographics, ending split)
- Users, Team & rights (seats/roles, consent + provenance ledger), Billing (payout balance, double-entry ledger)

### 3. Admin / Operator console (`Axessplayer Admin.dc.html`)
Desktop web app, 16-section rail (RBAC role chip + alerts in topbar). Sections: Dashboard, Content CMS, Adaptive story graph (nodes + memory variables), Media factory (auto-produce DAG with cost gate / retry / kill), Accessibility factory (readiness meter + Deaf-review queue), Brand integration (campaigns, OPE lift bands, brand/canon safety, plane firewall), Users, Creators (CRM + finance), Monetization (pricing rules engine), Analytics (funnel, treatment-vs-control band, propensity coverage), Growth & UA (CAC/LTV, creative-test bandit, referral K), Community & moderation (reports, scans, spoiler queue), Rights/consent/provenance (consent ledger, C2PA, EU/Swiss residency, GDPR), Billing & payouts (double-entry ledger, payout runs), System health (QoE, services), Settings & roles (RBAC, immutable audit trail incl. founder sign-off).

## Recap engine ("Previously in your cut") — reference implementation
Implemented live in `Axessplayer App.dc.html` (Section 12 in the board; logic in the Design Component's class). Behavior to port:

- **Inputs (per viewer):** `viewer_state` { pov, language, favoriteCharacter, branchPath[], skippedScenes[], lastBeat } derived from `viewer_state + decision_log + events`.
- **Variant pool:** existing cached beat variants `{ id, beat, order, pov, character, thumb, captions{en,es,...} }`. The recap **selects** variants; it never renders per viewer live.
- **`assembleRecap(state)`:** filter pool to beats on `branchPath`, matching the viewer's `pov` (or pov "any"), drop `skippedScenes`, sort chronologically with `favoriteCharacter` prioritized within ties, take the last 3 beats, localize caption by `language`, flag favorite-character beats.
- **Acceptance (met in prototype):** two viewers with different histories produce visibly different recaps (different thumbs, captions, language, and branch beats) reflecting their actual choices.
- **Instrumentation:** emit `recap_shown` (with beat count + variant ids) on assembly, `recap_skipped` and `continued_after_recap` on the respective actions. Prototype logs to `window.__axpRecapEvents` + console + an on-screen event strip; port to the real analytics event schema.

## Variant substrate (data model to implement)
Every variant carries: `assetId, seriesId, episodeId, beatId, language, accessibilityTracks[], monetizationState, branchState, rightsState, provenanceMetadata, c2paStatus, article50LabelStatus, analyticsEventMapping`, plus `variant_source = uploaded_master | ai_generated | adapted_archive | brand_integrated | personalized_cache`.

## Interactions & behavior
- **Console nav:** click `[data-nav]` shows the matching `[data-panel]` (others `display:none`), sets active rail item (rose tint bg, white text), resets scroll. Pure DOM toggle in the prototype; implement as routes.
- **Simple/Pro toggle** (Studio): reveals `[data-pro-only]` elements (e.g., full branch graph).
- **Recap skip/continue, character-inbox choices, branch-as-quest options:** emit analytics events; wire to the decision/economy services.
- Counterfactuals must always render as a **band, not a point**.

## Assets
In `assets/` (copied into this bundle): six original series posters (`poster_shadow/vow/director/luna/heiress/alpha.png`), scene stills (`cut_frame, scene_es, scene_lounge, scene_beach, scene_desk, scene_ar2.png`), brand product stills (`dpp_topochico/coke/masafi.png`), and app/marketing imagery. These are placeholder creative; production uses real series assets. Logo is an inline SVG (rose rounded-square play mark with two vertical cut bars) reproduced in each file's header.

## Files
- `Axessplayer App.dc.html` — viewer app (mobile screens + desktop web view + recap engine + delight layer)
- `Axessplayer Studio.dc.html` — Creator Studio
- `Axessplayer Admin.dc.html` — Admin / Operator console
- `Axessplayer Home.dc.html`, `Axessplayer Enterprise.dc.html`, `Axessplayer About.dc.html` — marketing site (brand reference)
- `Axessplayer Pitch Deck.dc.html` — investor deck (narrative + visual language reference)
- `Axessplayer Brand Guidelines.dc.html` — color, type, logo system, applications
- `assets/` — imagery referenced by the above

> Note: `.dc.html` files are Design Components. Open directly in a browser to view. The viewer app's recap logic lives in the component's script class and is the one piece of real reference logic to port; everything else is presentational.
