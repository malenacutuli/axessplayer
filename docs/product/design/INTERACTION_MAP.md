# Interaction map: every action, destination, landing UI, and data wiring

This document specifies, for every actionable element across the three product surfaces, **where it leads**, **the landing UI**, **the data source that should feed it**, and **what a developer should wire it to**. The prototypes are visual references; this file is the source of truth for behavior and data binding.

## Conventions

- **Routing**: each surface is a single app. In the prototypes, navigation is a client-side panel switch (`[data-nav]` shows the matching `[data-panel]`). In production, make each panel a real route so it is linkable, back-button-safe, and RBAC-guarded.
  - Viewer app routes: `/onboarding`, `/home`, `/series/:id`, `/watch/:episodeId`, `/wallet`, `/profile`, `/auth`, `/search`, `/channel/:id`, `/library`, `/favorites`, `/series/:id/comments`, `/invite`, `/recap/:seriesId`, `/inbox`.
  - Studio routes: `/studio/dashboard`, `/create`, `/library`, `/series/:id`, `/series/:id/branch`, `/posters/:seriesId`, `/adapter`, `/channels`, `/analytics`, `/monetization`, `/users`, `/team`, `/billing`.
  - Admin routes: `/admin/<section>` for each of the 16 sections.
- **Auth & roles**: every Studio and Admin route is RBAC-gated (`viewer | creator | studio_admin | brand | agency | finance | moderator | super_admin`). Mutations write to an immutable audit log.
- **Data services referenced**: `services/decision` (adaptive runtime), `services/ingestion` (media factory), `services/adaptation`, `services/accessibility`, `services/economy` (wallet/ledger), `services/catalog` (series/episode/variant), `services/storygraph`, `services/brand`, `services/analytics` (event sink + reports), `services/identity` (auth/consent), `services/social` (comments/character feed), `services/recap`. Persistence is Postgres; media via Mux/Cloudflare Stream with signed URLs.
- **Empty/loading/error**: every destination must define graceful empty, skeleton-loading, and error states. "Nothing changes on click" is a bug; if an action has no state change yet, it must at minimum open its landing route with an empty state.

---

## Surface 1: Viewer app

### Onboarding
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Start the cold open | `/onboarding/calibration` step 1 | Full-bleed scene with the first calibration question, 3-dot progress | Calibration question set from `services/decision` (cold-open template per channel) | On tap: create `viewer_session`, fetch question 1, render scene variant |
| Calibration choice (e.g. Slow burn) | next calibration step, then `/onboarding/ready` | Next question, or "your cut is ready" | Writes `viewer_preferences` (pacing, tone) + seeds `viewer_state` | POST each answer to `services/decision`; final answer triggers first-cut assembly |
| Play episode 1 (your cut is ready) | `/watch/:episodeId` | Vertical player with the personalized cut | `services/decision` returns personalized HLS manifest | Resolve manifest from seeded preferences, open player |
| Log in (instead) | `/auth` | Sign-in screen | `services/identity` | Standard auth |

### Auth
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Continue with Apple / Google | OAuth flow → `/onboarding` or `/home` | Provider sheet, then return | `services/identity` (OAuth) | New users → onboarding; returning → home |
| Email address | `/auth/email` (OTP) | Email + code entry | `services/identity` | Magic-link / OTP |
| Create profile · channel picks | `/home` | Channel interest chips, avatar/handle | Writes `viewer_preferences.channels`, handle to `users` | Persist; seeds home feed ranking |
| Enter Axessplayer | `/home` | Home feed | — | Commit profile, route home |

### Home & discovery
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Continue-watching hero | `/watch/:episodeId` resume | Player at saved position | `viewer_branch_history` + last position | Resume from `services/decision` |
| Trending poster tile | `/series/:id` | Series detail | `services/catalog` ranked by `services/analytics` | Open detail; poster art chosen by decision service |
| Credits pill | `/wallet` | Wallet | `services/economy` balance | Route to wallet |
| Bottom tab (Home/Search/Wallet/You) | respective route | that screen | — | Tab router; center play = resume current |
| Series detail · Play | `/watch/:episodeId` | Player | `services/decision` manifest | Resolve cut for this viewer |
| Series detail · + (add) | stays, toggles state | Button fills | Writes `viewer_library` | Optimistic toggle, POST add/remove |
| Locked episode | premium unlock sheet | Unlock sheet over detail | `coin_cost` from `services/catalog` + balance | Open `/series/:id/unlock` |
| Accessibility badges (CC/AD/SIGN/lang) | accessibility drawer | Drawer with toggles | `services/accessibility` track availability | Open drawer, reflect this title's tracks |

### Player, branch, accessibility
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Like | inline | Heart fills, count +1 | `services/social` reactions | Optimistic; emit `like` event |
| Cuts (right rail) | cuts sheet | Available POV/intensity/lang cuts | `services/catalog` variants for this beat | List variants; selecting one re-resolves manifest |
| AD toggle | inline | Audio description on | `services/accessibility` | Switch audio track in player |
| Share | OS share sheet | Native share | — | Deep link to series; emit `share` event |
| Branch choice (Trust / Walk away) | next beat | Player continues on chosen branch | Writes `viewer_branch_history` + memory vars; `services/decision` serves next | POST choice; countdown default = fallback route |
| Accessibility drawer toggles | inline | Track on/off, sign PiP, language list | `services/accessibility`; writes `viewer_preferences` defaults | Persist as defaults across titles |
| Language chip | inline | Switches dub/captions | `services/catalog` language variants | Re-resolve manifest in chosen language |

### Monetization
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Unlock premium variant (alt ending / POV / intensity) | confirm → player | Variant unlock confirm, then plays | `coin_cost` per variant; `services/economy` debit | Check balance → debit → grant entitlement → play; insufficient → `/wallet` |
| Wallet · Watch a short ad (Earn) | rewarded ad → wallet | Ad player, then +credits | Ad SDK + `services/economy` credit | On complete, credit ledger, emit `ad_watched`, `credits_earned` |
| Wallet · Buy pack | payment sheet → wallet | Store sheet (Stripe/IAP) | `services/economy` + Stripe TEST | Purchase → credit; idempotent receipt reconcile |
| Wallet · Subscribe | subscription sheet | Plan confirm | `services/economy` subscriptions | Start sub; unlock ad-free + allowance |

### Account, search, channels
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Profile continue-watching row | `/watch/:episodeId` | Player resume | `viewer_branch_history` | Resume |
| Accessibility defaults / Manage subscription | `/profile/accessibility`, `/profile/subscription` | Settings sub-pages | `viewer_preferences`, `services/economy` | Sub-routes |
| Search field | `/search` results | Live results | `services/catalog` search + `services/analytics` trends | Debounced query |
| Channel tile (Telenovela, Crime, …) | `/channel/:id` | Channel detail | `services/catalog` by channel | Open channel |
| Channel · Follow | toggles | Button state + bell | Writes `channel_follows` | Subscribe to notifications |

### Library, favorites, community, invite
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Library tabs (Saved/Downloads/History) | filters in place | Grid swaps | `viewer_library`, `viewer_downloads`, watch history | Tab filter |
| Download tile | inline | Download progress → offline-ready | `viewer_downloads` + entitlement-aware packaging (DRM, a11y tracks offline) | Package with expiry |
| Favorite show/character | toggles | Heart/border state | `viewer_favorites`, `character_follows` | Optimistic toggle |
| Character story / post | character detail / post view | Feed item | `services/social` `character_posts` | Open post; like/comment |
| Comments · Post / Reply | inline append | New comment in thread | `services/social` `comments` (spoiler-gated, moderated) | POST; run toxicity/spoiler classify; emit `comment_posted` |
| Invite · Copy / Share | clipboard / OS share | Code copied / share sheet | `viewer_referrals` (code, milestones) | Generate code; track installs + reward both sides on first watch; fraud checks |

### Recap engine ("Previously in your cut")
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Auto-shown on series return | recap overlay | Assembled recap beats | `viewer_state + decision_log + events` → `services/recap.assembleRecap()` selecting cached beat variants | Emit `recap_shown {beats, variantIds}` |
| Continue watching | `/watch/:episodeId` at lastBeat | Player | `viewer_branch_history` | Emit `continued_after_recap`; resume |
| Skip | `/watch/:episodeId` at lastBeat | Player | — | Emit `recap_skipped`; resume |

### Delight layer
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Character inbox message / voice note | inbox thread | In-character message view | `services/social` scripted character messages (age-gated) | Render; guardrails enforced server-side |
| Inbox · secret clue (paid) | unlock confirm | Clue reveal | `services/economy` debit | Debit → reveal |
| Inbox · choose what I do next | next beat / branch | Branch applied | `services/decision` + `viewer_branch_history` | Same as branch choice |
| Branch-as-quest · invite / watch-ad / spend | respective flow → unlock | Quest option flows | `viewer_referrals` / ad SDK / `services/economy` | Any path satisfies unlock; community goal aggregates across viewers |
| Dynamic poster (served) | n/a (display) | Artwork chosen for viewer | `services/decision` picks from creator's poster set by learned behavior | No chooser; log poster `impression` + CTR |

---

## Surface 2: Creator Studio

Global: top-bar **search** → `/search` scoped to creator's catalog; **Simple/Pro toggle** flips a `mode` flag that reveals `[data-pro-only]` controls (e.g. full branch graph, manual variant placement) — in production persist per-user and gate advanced fields; **generation-credits meter** → `/billing`; **avatar** → account menu.

### Dashboard
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| + Create or upload | `/create` | Create with AI panel (model picker + clip stitch) and upload master | — | Primary CTA → create route |
| Last 28 days (range) | in-place refresh | Dropdown: 7d / 28d / 90d / custom | `services/analytics` windowed query | Re-query all dashboard cards on change |
| KPI cards (views/watch-time/revenue/payout) | drill-through report | Filtered analytics report | `services/analytics`; payout from `services/economy` | Each card links to its `/analytics?metric=` view |
| Next best action: "ready to publish" | `/series/:id` (publish checklist) | Series editor at publish step | `services/catalog` status + `services/accessibility` readiness | Deep link to that series |
| Next best action: "brand wants placement" | `/series/:id` brand tab or `/channels` deals | Brand offer review | `services/brand` offers inbox | Open offer; accept/decline |
| Next best action: "sign drafts await review" | `/series/:id` review queue | Accessibility review | `services/accessibility` review queue | Open queue |
| Top-series row | `/series/:id` | Series editor | `services/catalog` | Open series |

### Create with AI
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Channel dropdown | in-place | Options: Telenovela, Drama, Comedy, Reality, Podcast, Thriller, Crime, Education, Children | `services/catalog` channel list | Sets channel context; feeds viral-playbook + ranking |
| Episode length control | in-place | Slider 15–90s | — | Caps stitch total; validate ≤ 90s |
| Branches on/off | in-place | Toggle | `services/storygraph` | On = creates branch points in the assembled episode |
| How to develop viral episodes | `/learn/viral?channel=` | Tutorial/playbook by channel (hook in 3s, timeline, cliffhanger) | CMS docs | Open contextual playbook for selected channel |
| Generation model (Veo 3.1 / Runway Gen-4 / Sora) | selects model | Highlights chosen model + its max clip length + credit cost | Model registry in `services/ingestion`; cost from `services/economy` | Selection sets per-clip credit rate; show live cost |
| Max clip length | in-place | Dropdown bounded by model max (8/10/12s) | Model capability | Clamp to model max |
| Generate clip | clip appears in "Generated clips" | New clip row (thumb, duration, model) | `services/ingestion` generation job → debits credits | Async job; on done append clip, debit ledger, emit cost |
| Regenerate clip | replaces clip | New take | `services/ingestion` | Re-run with same prompt/model |
| Generate another clip | new clip row | — | as above | — |
| Stitch · drag/trim/reorder | in-place | Timeline reorders, total updates | local edit state → `services/catalog` draft | Persist clip order + trims; enforce 90s cap |
| Assemble episode | `/series/:id` (new episode draft) | Series editor with assembled episode | `services/catalog` creates `episode` + variants; `services/storygraph` if branches on | Create episode from clip sequence; register variants |
| Upload a 9:16 master | upload → processing | Dropzone → media factory job | `services/ingestion` (encode to HLS) | Register as variant on beat; open processing state |
| Open adapter | `/adapter` | Live-action adaptation | — | Route to adapter |

### Content library
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| New series | `/series/new` | Empty series editor | `services/catalog` create | Create draft |
| Search / Status / Channel filters | in-place | Filtered table | `services/catalog` query params | Server-side filter + paginate |
| Bulk actions | in-place | Action menu on selected rows | `services/catalog` batch | Publish/unpublish/delete with confirm + audit |
| Row click | `/series/:id` | Series editor | `services/catalog` | Open |
| Coverage meter / C2PA cell | `/series/:id` accessibility / provenance tab | Detail | `services/accessibility`, provenance | Deep link |

### Series editor
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| + Add episode | episode draft | New episode row | `services/catalog` | Create episode |
| Episode row | `/series/:id/episode/:epId` | Episode editor / processing | `services/catalog` + `services/ingestion` | Open |
| Details fields (channel/genre/maturity/format incl. Podcast) | in-place save | Editable fields | `services/catalog` | Autosave draft |
| Accessibility & languages toggles + target langs | in-place | All-on by default, language chips | `services/accessibility` targets | Persist targets; compute fan-out |
| Process | processing dashboard | DAG progress | `services/ingestion` + `services/accessibility` | Kick fan-out job (langs × tracks) |
| Preview / Publish | preview player / publish checklist | — | `services/catalog` publish state | Validate readiness (a11y, provenance) before publish |

### Branch editor, Posters, Adapter
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Branch graph node/edge | node inspector | Beat/choice/ending editor | `services/storygraph` (versioned JSON) | Edit node; validate canon + broken links before publish |
| Add premium cut | variant + upsell | Priced variant slots into graph | `services/catalog` variant + `coin_cost`; `services/storygraph` | Create variant; wire upsell |
| Posters · Generate poster set / by emotion·character·language | poster set grid | Candidate posters with CTR | `services/ingestion` poster gen; CTR from `services/analytics` | Generate set; **decision service serves per-viewer** (creators never pick per-viewer art) |
| Posters · Push to A/B test | experiment | Variant test | `services/experiment` | Register CTR bandit |
| Adapter · Re-cut/Re-pace/Re-dress/Localize/Make accessible/Variants/Add brand/Marketing pack | preview → render | 15s preview first, then full render | `services/adaptation` (job DAG); confidence-gated | Preview render → approve → full render → register `adapted_archive` variant |
| Adapter · Render & register variant | `/series/:id` | New variant in series | `services/adaptation` → `services/catalog` | C2PA sign, AI label, register; decision service can serve it |

### Channels, Monetization, Users, Team, Billing
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| + Create channel | `/channels/new` | New channel page editor | `services/catalog` channels | Create |
| Edit page / Notify followers | channel editor / compose | — | `services/catalog`, `services/social` notifications | Edit; push to `channel_follows` audience |
| Monetization pricing fields & presets | in-place save | Editable pricing | writes `coin_cost`, free count, sub inclusion, ad tier | Persist via `services/catalog` + `services/economy` |
| Reward mechanism rows | in-place | Reward rules (ad/streak/referral/share) | `services/economy` reward config | Persist reward amounts |
| Revenue share bar | `/billing` | 70/30 breakdown | `services/economy` ledger | Drill to statements |
| Team · Invite seat / role | invite flow | Seat list | `services/identity` RBAC | Invite + scope role |
| Rights ledger entries | consent detail | Consent record | `services/identity` consent ledger | View scope/expiry/revocation |
| Billing · Withdraw | payout flow | Payout confirm | `services/economy` payouts (Stripe TEST) | Initiate payout run; statement |

---

## Surface 3: Admin / Operator console

Global: every route RBAC-gated; topbar **alerts** → red-alert feed; **role chip** reflects permissions; all mutations audited.

### Dashboard
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| KPI card (users/DAU/watch/branch/revenue/QoE) | `/admin/analytics?metric=` | Filtered report with drill-through | `services/analytics` | Each card links to its report |
| Date range / All markets | in-place refresh | Range + segment dropdowns | `services/analytics` filters | Re-query |
| Red-alert item (processing failure / spend cap / mod queue) | respective section | Media factory job / Billing / Moderation | `services/ingestion`, `services/economy`, `services/social` | Deep link to the alert source |

### Content CMS, Story graph, Media factory, Accessibility factory
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| + New series / row click | series detail | CMS editor | `services/catalog` | Create / open |
| Filters (status/channel/region) | in-place | Filtered table | `services/catalog` | Server filter |
| Content actions (publish/unpublish/re-run stage/approve/takedown/age-gate/availability) | confirm in place | Action result + audit toast | `services/catalog` + `services/ingestion` | RBAC + audit each mutation |
| Story graph node / Save version | inspector / version commit | Node editor | `services/storygraph` | Versioned JSON; "simulate viewer journey" runs `services/decision` in dry-run |
| Media factory · Pause/Retry/Kill, approve over-budget | job control | DAG state change | `services/ingestion` job controller | Idempotent stage control; cost-gate approval |
| Accessibility · Accept/Edit/Upload human clip | review action | Draft updated | `services/accessibility` review queue | Accept → register track; publish-blocking readiness meter |

### Brands, Users, Creators, Monetization
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| + New campaign / row | campaign detail | Campaign + slots + targeting | `services/brand` | Create/open; brand+canon safety hard filters |
| User row · Grant/Suspend/Refund/GDPR | confirm | Action + audit | `services/identity` + `services/economy` | RBAC; sensitive data minimized + logged |
| Creator row · onboard/verify/payout | creator CRM detail | Tier, KYC, rights, earnings | `services/identity` + `services/economy` | Open record |
| Monetization · pricing rules (regional/VAT/promo/variant prices) | in-place save | Rules editor | `services/economy` pricing engine | Persist by country/platform/content-type/cohort |

### Analytics, Growth, Moderation, Trust, Billing, Health, Settings
| Action | Destination | Landing UI | Data source | Developer wiring |
|---|---|---|---|---|
| Analytics views / export | report / CSV | Funnel, lift band, cohorts | `services/analytics` | Export CSV/API; saved segments; counterfactuals as bands |
| Growth · creative bandit / referral | experiment detail | Win-rates, K-factor | `services/experiment` | Promote requires OPE + live test + human gate |
| Moderation · Hide/Allow/Review/Approve | queue action | Item resolved | `services/social` + scanners | RBAC; CSAM/illegal scan on uploads + UGC |
| Trust · consent revoke / C2PA verify / GDPR | confirm | Ledger action | `services/identity` consent ledger | Revocation propagates to derived assets |
| Billing · payout run / reconcile | finance action | Ledger entry | `services/economy` double-entry ledger | Idempotent; reconcile to Stripe TEST |
| Policy · reward weights | display only | Read-only with sign-off notice | `services/decision` | **Founder sign-off only**; never operator-editable |
| Settings · roles / flags / env | settings sub-pages | RBAC, audit trail, flags | `services/identity` + config store | Secrets in platform store only, never client |

---

## Rule for developers
No action should be a dead end. If a control's backend is not built yet, it must still **open its landing route with an explicit empty/coming-soon state** and emit its analytics event, so the destination and wiring intent are unambiguous. Counterfactual metrics always render as bands. Every mutation is RBAC-gated and audited.
