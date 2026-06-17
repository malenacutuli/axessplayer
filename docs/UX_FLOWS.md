# Axessplayer UX and system flows

End-to-end flows for the Viewer app and the Studio, plus the overall system. Diagrams are Mermaid (render
on GitHub). Markers: [LIVE] proven against the hosted mobile schema, [PARTIAL] built but not fully wired,
[PLANNED] designed, not built. No em dashes.

Local ports: consumer 5173, Studio 5174, content 8093, economy 8091, decision 8092, manifest 8094,
media-server 8095, settlement 8100, console 8123. Hosted Supabase project faeyekynudyzeotbjfsj, schema
mobile.

---

## 1. System overview

```mermaid
flowchart LR
  subgraph Apps
    V[Viewer app :5173]
    S[Studio :5174]
    OPS[Operator console tab]
  end
  subgraph Services
    C[content :8093<br/>graph, feed, tracks,<br/>poster, publish, admin]
    D[decision :8092<br/>/decide + propensity]
    E[economy :8091<br/>wallet, spend, grant<br/>double-entry ledger]
    SET[settlement :8100<br/>rewards, paywall bandit]
    M[manifest :8094]
    MED[media-server :8095<br/>upload, HLS, serve]
  end
  subgraph Cloud[Supabase cloud]
    DB[(mobile schema<br/>series/beats/variants,<br/>coin_wallet, coin_transactions,<br/>decision_log, engagement_events)]
    EF[edge functions<br/>stability-ai, generate-dubbing,<br/>transcribe, twelve-labs, tts]
    ST[(public storage<br/>posters, dubs)]
  end
  LOCALAI[local pipeline<br/>whisper, ffmpeg, say,<br/>prosody DSP, sign dict]

  V -->|/feed /decide /spend /reward /paywall| C & D & E & SET
  V -->|video + tracks| MED
  S -->|/series /variants /admin /poster /publish| C
  S -->|upload| MED
  OPS -->|/admin/overview| C
  C & D & E --> DB
  SET -->|grant| E
  SET -->|paywall propensity| C
  C -->|poster gen| EF --> ST
  LOCALAI -->|auto-produce tracks| MED
  LOCALAI -->|dubs| EF
```

---

## 2. Viewer journey (overall)

```mermaid
flowchart TD
  start([Open app]) --> consent{Consent gate<br/>analytics_personalization?}
  consent -->|decide later / grant| feed[Feed: published series<br/>GET /feed  LIVE]
  feed -->|tap a card| open[openSeries -> load graph]
  open --> player[Player: adaptive cut]
  player --> decide[/decide returns next cut<br/>+ logs propensity  LIVE/]
  decide --> play[Play variant video<br/>or scene fallback]
  play --> a11y[Accessibility layer]
  a11y --> caps[CWI captions  LIVE]
  a11y --> sign[Sign PiP  LIVE]
  a11y --> ad[Audio description  LIVE]
  a11y --> lang[Language selector<br/>dub + captions  LIVE]
  player --> gate{Premium cut?}
  gate -->|yes, not owned| paywall[Paywall sheet  LIVE]
  paywall --> watchad[Watch ad to unlock]
  paywall --> buy[Buy coins  TEST]
  paywall --> sub[Subscribe  TEST]
  watchad --> grant[server grant +25 -> spend unlock  LIVE]
  gate -->|owned / free| play
  feed --> wallet[Wallet: balance + earn  LIVE]
  wallet --> earn[Rewarded ad / check-in / follow<br/>server-side grant_coins  LIVE]
```

---

## 3. Player internals (decide + accessibility + paywall)

```mermaid
sequenceDiagram
  participant U as Viewer
  participant P as Player
  participant D as decision :8092
  participant MED as media-server :8095
  participant E as economy :8091
  participant SET as settlement :8100

  U->>P: open series at cold-open beat
  P->>D: POST /decide {current_beat_id, signals}
  D-->>P: next_variant_id, propensity, policy_version
  Note over D: writes decision_log (propensity)  LIVE
  P->>P: resolve cut -> playable variant (qa passed + reachable)
  alt variant video reachable
    P->>MED: play variant /media clip
    P->>MED: fetch caption_doc_url, sign_video_url, ad.json, dub_audio_urls
  else unreachable (e.g. /manus-storage)
    P->>MED: play scene-fallback clip + its matched sceneA11y tracks  LIVE
  end
  P->>U: CWI captions (energy->size, f0->weight, harmonics->width) + sign PiP + AD
  U->>P: open A11y sheet -> toggle captions/AD/sign, pick language
  P->>MED: switch dub audio + <lang>_captions together

  opt premium beat, not owned
    P->>SET: POST /paywall/present {userId, beatVariantId}
    SET-->>P: bandit path + offers + tiers (DRAFT, not revenue-optimized)  LIVE
    Note over SET: logs presentation propensity to engagement_events
    alt watch-ad-to-unlock
      P->>SET: POST /reward/ad (verified)
      SET->>E: grant_coins rewarded_ad +25 (idempotent)  LIVE
      P->>E: POST /spend (unlock variant) -10 + entitlement  LIVE
    else buy / subscribe
      P->>P: TEST guard, never the live Stripe rail
    end
  end
```

---

## 4. Studio journey (overall)

```mermaid
flowchart TD
  lib[Library: real published series<br/>GET /feed  LIVE] -->|open| graphload[Load series graph]
  lib --> ops[Operator tab<br/>/admin/overview  LIVE]
  graphload --> branch[Branch editor<br/>beats + variants + edges  LIVE]
  branch --> media[Media and variants]
  media --> upload[Upload video -> HLS encode -> variant  LIVE]
  media --> poster[Poster: generate stability-ai -> poster_url  LIVE]
  media --> pricing[Pricing: premium + coin_cost  LIVE]
  pricing --> publish[Publish to feed  LIVE]
  media --> autoproduce[Auto-produce one click  PARTIAL]
  branch --> signpanel[Sign panel: upload human clips per sentence  PLANNED]

  ops --> metrics[Content inventory, a11y coverage,<br/>double-entry ledger, decisions]
```

---

## 5. Auto-produce pipeline (upload to published accessible title)

```mermaid
flowchart LR
  up[Upload video<br/>Studio Media  LIVE] --> enc[HLS encode<br/>media-server  LIVE] --> var[Variant on a beat]
  var --> prod{{Auto-produce}}
  prod --> asr[ASR: local whisper<br/>word timestamps  LIVE]
  asr --> caps[CWI captions:<br/>prosody DSP + intensity  LIVE]
  asr --> dub[Dubs: generate-dubbing<br/>translate + ElevenLabs  LIVE]
  asr --> sem[Speaker/emotion:<br/>OpenAI over transcript  PLANNED]
  var --> adv[AD: TwelveLabs vision<br/>needs public video URL  PLANNED]
  var --> sign[Sign: local dict concat<br/>or human upload  PARTIAL]
  caps --> reg[Register tracks<br/>PATCH /variants/id/tracks  LIVE]
  dub --> reg
  sem --> reg
  adv --> reg
  sign --> reg
  var --> pos[Poster: stability-ai  LIVE]
  reg --> pub[Publish to feed  LIVE]
  pos --> pub
  pub --> done([Published, accessible,<br/>multilingual title])
```

Proven run (variant 7d7fcab6, upload mqiei6lu, 47 dialogue segments): whisper -> 47-segment CWI captions
-> es + fr real translated dubs -> poster -> publish, all registered and serving. A no-speech clip yields
empty captions correctly (the speech-dependent stages need dialogue).

---

## 6. Monetization flows

```mermaid
flowchart TD
  subgraph Rewards [Earn coins  LIVE]
    ra[Watch rewarded ad] --> rac[server callback /reward/ad<br/>daily cap 5, idempotent]
    ci[Daily check-in<br/>forgiving streak] --> cic[/reward/checkin once/day]
    fb[Follow bonus] --> fbc[/reward/follow once]
    rac & cic & fbc --> gc[grant_coins -> double-entry ledger<br/>never from client]
  end
  subgraph Paywall [Unlock premium  LIVE backend]
    pp[/paywall/present] --> bandit[DRAFT path bandit<br/>watch_ad / buy / subscribe<br/>neutral, propensity-logged,<br/>NO revenue extraction]
    bandit --> wa[watch-ad-to-unlock<br/>grant then spend  LIVE]
    bandit --> bu[buy coin pack  TEST]
    bandit --> su[subscribe tier  TEST]
  end
```

Hard rules that no sign-off lifts: revenue extraction is never the bandit objective; anti-dark-pattern
(spend cool-down, transparent pricing, no manipulation); content/ad firewall; the live Stripe rail is never
invoked without a separate decision.

---

## 7. Sign language: current vs planned

```mermaid
flowchart LR
  subgraph Now [Default  PARTIAL]
    tr[Transcript words] --> gloss[text-to-gloss over<br/>local per-word dictionary]
    gloss --> concat[concatenate clips + holds<br/>build-sign.mjs] --> webm[one lang_sign.webm] --> pip[Sign PiP plays it  LIVE]
  end
  subgraph Future [Human sign  PLANNED]
    sent[Studio lists caption sentences] --> humanup[Author uploads a human clip<br/>per sentence]
    humanup --> man[Sign manifest<br/>sentence,time,clipUrl,signedBy<br/>= training dataset]
    man --> asm[Assemble human clips<br/>dict fallback per missing sentence] --> webm
  end
```

The PiP contract stays one webm, so human uploads need no player change; the manifest doubles as the
sign-model training set.

---

## 8. Founder gates (state)

- Money/ledger: signed off. Stripe stays TEST until a separate live-rail decision.
- Biometric/consent + provenance: signed off (consent-ledger + C2PA writes may go live).
- Reward-weights: signed off (bandit may optimize on viewer continuation; extraction stays off).
