# Axessplayer: Build and Sequencing Addendum

This addendum details the specific technical mechanisms and build sequences for the five core platform engines: Revenue Share, Dynamic Placement, AI Generation, Recommendation/Adaptation Algorithms, and Accessibility.

## 1. Revenue Share Mechanism

The revenue share system operates on a double-entry ledger to ensure auditable, idempotent transactions.

- **Sources:** Unlocks (coin spend), rewarded ads, brand placements, and attributed subscriptions.
- **Mechanism:**
  - When a viewer spends coins to unlock an episode, the ledger debits the viewer's wallet and credits the platform holding account.
  - A scheduled edge function (e.g., `process_creator_payouts`) calculates the creator's share (e.g., 50 percent) based on the contract terms.
  - The function transfers the share from the holding account to the creator's ledger balance.
  - Agency tiers allow for parent-child ledger relationships, where revenue routes to the agency wallet with a defined split for the talent.
- **Payout:** Creators request withdrawal via Stripe Connect, triggering a ledger debit and a fiat payout.

## 2. Dynamic Brand Placement Engine

This engine handles the region-addressable, demographic-targeted insertion of products into pre-rendered scenes.

- **Authoring:** Creators define "fillable slots" in the branch-graph editor (e.g., a beverage can on a table).
- **Matching:** The placement-rules engine matches active brand campaigns to slots based on the viewer's region, demographic, and the scene's context.
- **Generation:**
  - The system uses a static-composite-then-animate pipeline.
  - **Step 1:** Background removal of the brand asset.
  - **Step 2:** Instruction-based image edit (e.g., using Seedream or Nano Banana) with a detail-preserving prompt to composite the product into the base frame.
  - **Step 3:** Image-to-video generation (e.g., Kling 3.0 or Seedance) to animate the composite.
- **Serving:** The adaptive engine serves the generated variant to the matched viewer cohort.

## 3. AI 90-Second Episode Generator

The automated generation pipeline allows creators to go from premise to published episode using a multi-model orchestration strategy.

- **Pipeline:**
  - **Scripting:** LLM (GPT-4 class) expands a premise into a beat sheet, then into scene dialogue and shot directions.
  - **Identity:** Creators select or train a LoRA identity model for consistent character appearance across shots.
  - **Video Generation:** Shots are generated using Kling 3.0 for cinematic multi-shot sequences or Veo 3.1 for scenes requiring synced audio in a single pass.
  - **Audio & Lip-Sync:** ElevenLabs generates voiceover; Seedance 2.0 provides phoneme-level lip-sync for dubbed or non-native audio.
  - **Assembly:** The system stitches shots, applies transitions, and outputs a canonical story graph and render manifest.

## 4. Learning Algorithm (Recommendation & Adaptation)

The algorithm fuses content discovery with per-beat narrative adaptation.

- **Recommendation (Discovery):**
  - **Retrieval:** Two-tower model (User/Item) for fast candidate selection, augmented by Deep Retrieval for latent-path encoding.
  - **Ranking:** MMoE (Multi-gate Mixture-of-Experts) model predicting completion, duration-debiased watch time (D2Q), likes, and paywall conversion.
- **Adaptation (Re-cutting):**
  - Modeled as a contextual bandit.
  - **Context:** Viewer embedding, session state, and current beat features.
  - **Action:** Selection of the next beat variant (e.g., fast pace vs. slow pace).
  - **Reward:** Multi-objective function prioritizing D7 return and penalizing skip/rage-scrub.
  - **Learning:** Propensities are logged with every impression, enabling off-policy evaluation (IPS) to test new re-cutting policies safely before deployment.

## 5. Accessibility Stack (Vertical-Adapted)

The accessibility features are first-class, natively integrated components, not afterthoughts.

- **Captions with Intention (CWI):**
  - Rendered using Roboto Flex (variable typography).
  - Employs a 42-color palette for speaker attribution.
  - Dynamically positions in the lower 20 percent safe area, adjusting for vertical (9:16) constraints to avoid UI chrome and faces.
  - Word-level synchronization with size pops for emphasis.
- **Audio Description (AD):** AI-drafted and human-reviewed, fitting descriptions into dialogue gaps, with an "Extended" mode that pauses playback for full context.
- **Sign Language PiP:** A draggable, resizable Picture-in-Picture window featuring human signers or avatar tracks, synchronized to the playback.
- **Multilingual Support:** A single global language setting drives the audio dub, CWI track, AD track, and Sign track simultaneously.

---

*Document authored by Manus AI based on Axessplayer technical blueprints, UI specifications, and market research.*
