// Pricing panel: episode access, the premium ending price in coins (own-once), and a rewarded-ad toggle.
// The coin price is the coin_cost on the premium beat_variant, which the hardened spend_coins ledger
// enforces idempotently. Setting the price registers a premium variant (POST /variants with is_premium and
// coin_cost) on the chosen ending beat.
//
// CONTRACT GAP (flagged): the content service exposes only POST /variants, no PATCH/PUT. So a NEW premium
// price can be created, but editing the coin_cost of an EXISTING premium variant in place is not possible
// without a content.yaml change (an update endpoint). The UI says so and disables in-place edits. No em
// dashes.
import { useState, type FormEvent } from "react";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";
import type { FlatGraph } from "../../api/flattenGraph.js";

export interface PricingPanelProps {
  graph: FlatGraph;
  onCreated: () => void;
  onGoToPublish: () => void;
}

type Status =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "ok"; message: string }
  | { state: "error"; message: string };

export function PricingPanel({ graph, onCreated, onGoToPublish }: PricingPanelProps): JSX.Element {
  const client = useContentClient();
  const existingPremium = graph.variants.find((v) => v.is_premium);
  // Ending beats are the natural home for a premium alternate ending; fall back to any beat.
  const endingBeats = graph.beats.filter((b) => b.role === "ending");
  const targetBeats = endingBeats.length > 0 ? endingBeats : graph.beats;

  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [price, setPrice] = useState(String(existingPremium?.coin_cost ?? 5));
  const [beatId, setBeatId] = useState(targetBeats[0]?.id ?? "");
  const [access, setAccess] = useState("free");
  const [rewardedAd, setRewardedAd] = useState(true);

  const onSetPrice = async (e: FormEvent) => {
    e.preventDefault();
    if (!beatId) return;
    setStatus({ state: "submitting" });
    try {
      const row = await client.createVariant({
        beat_id: beatId,
        tier: "A_filmed",
        is_premium: true,
        coin_cost: Number.parseInt(price, 10) || 0,
        // Encode is out of scope: register the premium ending row from a placeholder URL.
        playback_url: `https://cdn.example/placeholder/premium-${beatId}.m3u8`,
      });
      setStatus({ state: "ok", message: row.id });
      onCreated();
    } catch (err) {
      const message =
        err instanceof ContentApiError
          ? (err.apiError ?? `error_${err.status}`)
          : err instanceof Error
            ? err.message
            : "request_failed";
      setStatus({ state: "error", message });
    }
  };

  return (
    <div className="spanel" data-testid="panel-pricing">
      <div className="sbar">
        <div>
          <div className="ey rose">Monetization</div>
          <h2 style={{ marginTop: 8 }}>Pricing</h2>
        </div>
        <button type="button" className="btn" onClick={onGoToPublish} data-testid="goto-publish">
          Publish →
        </button>
      </div>

      <form className="pricebox" onSubmit={onSetPrice} aria-label="Pricing" data-testid="form-pricing">
        <div className="fld">
          <label htmlFor="pr-access">Episode access</label>
          <select id="pr-access" value={access} onChange={(e) => setAccess(e.target.value)}>
            <option value="free">Free (ad-supported)</option>
            <option value="chapter4">Unlock from chapter 4</option>
          </select>
        </div>

        <div className="fld">
          <label htmlFor="pr-beat">Premium ending beat</label>
          <select id="pr-beat" value={beatId} onChange={(e) => setBeatId(e.target.value)}>
            {targetBeats.map((b) => (
              <option key={b.id} value={b.id}>
                #{b.beat_index} {b.role}
              </option>
            ))}
          </select>
        </div>

        <div className="fld">
          <label htmlFor="pr-price">Premium alternate ending</label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              id="pr-price"
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              style={{ width: 84 }}
            />
            <span className="muted">coins - own-once</span>
          </div>
          {existingPremium ? (
            <p className="muted" style={{ marginTop: 6 }} data-testid="premium-current">
              Current premium variant priced at {existingPremium.coin_cost} coins. Editing it in place needs
              a content.yaml update endpoint (flagged); this registers a new premium variant.
            </p>
          ) : null}
        </div>

        <label className="toggle2">
          <button
            type="button"
            className={`toggle${rewardedAd ? "" : " off"}`}
            onClick={() => setRewardedAd((r) => !r)}
            aria-pressed={rewardedAd}
            aria-label="Offer rewarded-ad unlock"
          >
            <i />
          </button>
          Offer rewarded-ad unlock
        </label>

        <div className="rowend" style={{ marginTop: 14 }}>
          <button type="submit" className="btn pri" disabled={status.state === "submitting" || !beatId}>
            Set premium price
          </button>
        </div>

        {status.state === "ok" ? (
          <p className="statusline ok" role="status" data-testid="form-pricing-ok">
            Created premium variant {status.message}
          </p>
        ) : null}
        {status.state === "error" ? (
          <p className="statusline err" role="alert" data-testid="form-pricing-error">
            Error: {status.message}
          </p>
        ) : null}
      </form>

      <div className="help">
        Server-authoritative. The number here is the coin_cost the hardened spend_coins ledger enforces,
        idempotently.
      </div>
    </div>
  );
}
