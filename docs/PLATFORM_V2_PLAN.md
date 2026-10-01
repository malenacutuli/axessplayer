# Platform v2: free, accessible-by-default video for every creator

Direction (2026-10-01): a YouTube-style creator platform that feels like Netflix and TikTok had a baby.
Free for viewers. Paid for by ads and by brands sponsoring creators. Accessible by default. Vertical and
horizontal. Built on what Release 1 already shipped (Supabase auth, series ownership, Cloudflare Stream,
signed playback, events, brand service). No em dashes.

## The product in one screen each

| Surface | Feels like | What it is |
|---|---|---|
| **Shorts feed** | TikTok | Full-screen vertical swipe feed of short videos (< 3 min), autoplay, captions on. |
| **Home / browse** | Netflix | Rows: Continue watching, Trending, For you, Series, by genre/language. Horizontal long-form and series. |
| **Watch page** | YouTube | Any video, any aspect ratio, player adapts (9:16, 16:9, 1:1), accessibility tray, up next, creator channel. |
| **Interactive series** | Axessplayer today | The branching microdrama engine stays as a premium format inside the same platform. |
| **Studio** | YouTube Studio | Upload anything, accessibility auto-generated, analytics, earnings, sponsorship offers. |
| **Brand portal** | Sponsorship marketplace | Brands fund campaigns, pick creators/categories, see delivery and reach. |

## What changes in the model

1. **Videos, not only series.** A standalone upload is a `video` (single item, any length/aspect) that can
   optionally belong to a playlist or series. The branching series graph remains for interactive titles.
   Every video has `orientation` (vertical / horizontal / square, from Stream's input dimensions),
   `duration`, `format` (short / long / interactive), channel, language, category.
2. **Free for viewers.** Premium unlocks are retired for viewers (coins remain for optional tips). Revenue comes from:
   - **Brand sponsorship** (direct-sold): a brand funds a campaign; matched creators carry a disclosed
     sponsor card / pre-roll bumper / in-scene placement (the brand service already models campaigns,
     placements, brand safety). Spend is split creator / platform.
   - **Programmatic ads** (later): VAST pre/mid-roll via Google IMA when the ad account is approved.
3. **Creators get paid.** Revenue share ledger per creator from sponsorship and ad revenue; payouts through
   Stripe Connect (Express) on the existing Stripe account.
4. **Accessible by default.** On every upload: auto captions (Stream's AI captions or the Axessible
   transcription pipeline) -> WebVTT on Stream; audio description, sign language, and dubs from the existing
   Axessible pipeline, queued automatically, shown as badges and in the player's accessibility tray.
5. **Formats.** Stream serves adaptive HLS/DASH at every rung; captions as WebVTT; downloads (MP4) for
   creators; thumbnails/animated previews from Stream.
6. **Viewership data.** The events service records impressions, starts, quartiles, completes, seeks,
   accessibility-track usage, ad/sponsor impressions (consent-gated). Aggregated into creator analytics and
   brand delivery reports; also feeds the recommender.

## Build phases (each shippable, each behind the existing release checks)

| Phase | Ships | Builds on |
|---|---|---|
| **P1 Videos + any aspect** | `videos` model + upload of standalone videos from the studio; orientation from Stream; watch page and player adapt to 9:16 / 16:9 / 1:1; channel pages | Stream upload (Release 1), content ownership |
| **P2 Two feeds** | Shorts swipe feed (vertical) + Netflix-style home rows (horizontal/long-form/series); search | feed, catalog, recommender (deploy it) |
| **P3 Accessible by default** | Auto captions on ready (webhook -> captions job -> WebVTT on Stream), AD/sign/dub queued, accessibility badges, player tray for any video | Stream webhook, ingestion pipeline |
| **P4 Free + sponsorship** | Retire viewer paywalls; brand portal (campaigns, budgets, targeting by category/language/accessibility), creator opt-in to sponsors, disclosed sponsor cards / bumpers, impression + completion tracking, Article 50 / FTC disclosure | brand service, events |
| **P5 Creator money** | Revenue ledger per creator (sponsorship + ads), Stripe Connect Express onboarding, monthly payouts, earnings in Studio | economy ledger, Stripe |
| **P6 Viewership analytics** | Quartiles/retention per video, audience by language/accessibility usage, brand delivery reports | events, admin-api |
| **P7 Programmatic ads** | VAST via Google IMA pre/mid-roll on long-form, frequency caps, ad-free accessibility guarantees (captions on ads) | P4 slots |
| **P8 Mobile app** | Expo player for both feeds (the web app is responsive and works on phones meanwhile) | apps/mobile |

## Decisions (Malena, 2026-10-01)

1. **Ads: both, staged, production-grade.** Direct brand sponsorship ships first; programmatic VAST ads
   (Google IMA client-side, server-verified impressions, frequency caps, captioned ad breaks) are built to
   production standard in the same ad-decision path and switched on when the ad account is approved.
2. **Coins: kept as optional tipping.** Watching is always free; viewers may buy coins to tip creators.
   Premium unlocks are retired for viewers; the wallet and Stripe purchase flow stay for tips.
3. **Payouts: Stripe Connect Express, 70/30** (creator 70%, platform 30%) for sponsorship, ad, and tip revenue.
4. **Mobile: native app in parallel** (Expo, iOS + Android) alongside the responsive web.

## Out of scope until decided

Live streaming, comments/community moderation at scale, and creator-to-creator collaboration are not in
P1 to P8; comments need a moderation plan before launch.
