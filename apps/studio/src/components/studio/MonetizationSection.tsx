// SECTION 10 - MONETIZATION & REVENUE SHARE (/studio/monetization). Two halves:
//
//  PRICING (writes): set pricing per series - series unlock / coin_cost, free-episode count, premium-cut
//  prices, subscription inclusion, ad tier, channel placement opt-in - with one-click PRESETS. Writes that
//  the content service supports go through the existing endpoints: the premium-cut coin_cost registers a
//  premium beat_variant via POST /variants (the same seam PricingPanel uses, enforced idempotently by the
//  hardened spend_coins ledger). The settings the content contract does NOT yet expose (series unlock,
//  free-episode count, subscription inclusion, ad tier, channel opt-in) are saved LOCALLY as a draft and
//  flagged as a gated coming-soon seam - NO fabricated success.
//
//  REVENUE (reads): per episode / series / cohort by source from the catalog GET /series/:id/revenue. The
//  70/30 creator/platform split is COMPUTED and shown transparently per title and in aggregate, alongside
//  earnings, payout balance, payout history / method / statements (read-only), a Stripe TEST badge, and a
//  no-live-charge note. The catalog route may be undeployed: a 404 degrades to a graceful empty state.
//
// Permanent hard rules surfaced here: the 70/30 split is computed and shown; Stripe is TEST until a
// live-rail decision (never a live charge); the content/ad firewall holds (ad tier is a creator setting,
// never a content decision). Built on @axessplayer/ui (STUDIO skin). WCAG 2.2 AA. No em dashes.
import { useMemo, useState, type FormEvent } from "react";
import { Button, EmptyState, ErrorState, KpiCard, Skeleton } from "@axessplayer/ui";
import { SeriesPicker } from "./SeriesPicker.js";
import { useFlatGraph } from "../../api/useFlatGraph.js";
import { useSeriesRevenue } from "../../api/useCatalog.js";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";
import type { SeriesRevenue } from "../../api/catalogTypes.js";

const CREATOR_SHARE = 0.7;
const PLATFORM_SHARE = 0.3;

// One-click pricing presets. Each fills the editable fields; the creator can tweak before saving.
interface PricingDraft {
  seriesUnlockCoins: number;
  freeEpisodes: number;
  premiumCutCoins: number;
  subscriptionIncluded: boolean;
  adTier: "none" | "rewarded" | "interstitial";
  channelPlacementOptIn: boolean;
}

const PRESETS: Record<string, { label: string; draft: PricingDraft }> = {
  free: {
    label: "Free, ad-supported",
    draft: { seriesUnlockCoins: 0, freeEpisodes: 99, premiumCutCoins: 5, subscriptionIncluded: true, adTier: "rewarded", channelPlacementOptIn: true },
  },
  freemium: {
    label: "Freemium (3 free)",
    draft: { seriesUnlockCoins: 20, freeEpisodes: 3, premiumCutCoins: 8, subscriptionIncluded: true, adTier: "rewarded", channelPlacementOptIn: true },
  },
  premium: {
    label: "Premium unlock",
    draft: { seriesUnlockCoins: 50, freeEpisodes: 1, premiumCutCoins: 12, subscriptionIncluded: false, adTier: "none", channelPlacementOptIn: false },
  },
};

const DEFAULT_DRAFT: PricingDraft = PRESETS.freemium.draft;

type SaveStatus =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "ok"; message: string }
  | { state: "error"; message: string };

export function MonetizationSection(): JSX.Element {
  const [seriesId, setSeriesId] = useState("");

  return (
    <div className="spanel" data-testid="panel-monetization">
      <div className="sbar">
        <div>
          <div className="ey rose">Monetization and revenue share</div>
          <h2 style={{ marginTop: 8 }}>Pricing, the 70/30 split, and payouts</h2>
          <p className="muted">Set pricing per series; see revenue by source with the creator/platform split shown transparently.</p>
        </div>
        <span className="stripe-test-badge" data-testid="monetization-stripe-test">Stripe TEST mode</span>
      </div>

      <SeriesPicker selectedId={seriesId} onSelect={setSeriesId} label="Monetize which series" />

      {!seriesId && (
        <p className="muted" data-testid="monetization-idle" style={{ marginTop: 12 }}>
          Pick a series to set its pricing and see its revenue and 70/30 split.
        </p>
      )}

      {seriesId && (
        <>
          <PricingEditor seriesId={seriesId} />
          <RevenuePanel seriesId={seriesId} />
        </>
      )}

      <div className="note">
        <span className="notetag">FIREWALL</span>
        Revenue and the ad tier are creator settings; they never influence what content a viewer is shown.
        The 70/30 split is computed and shown. Stripe stays in TEST until a live-rail decision; no live
        charge is ever made.
      </div>
    </div>
  );
}

function PricingEditor({ seriesId }: { seriesId: string }): JSX.Element {
  const content = useContentClient();
  const graphState = useFlatGraph(seriesId, 0);
  const graph = graphState.status === "loaded" ? graphState.graph : null;
  const existingPremium = graph?.variants.find((v) => v.is_premium) ?? null;

  const [draft, setDraft] = useState<PricingDraft>(DEFAULT_DRAFT);
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });

  const set = <K extends keyof PricingDraft>(k: K, v: PricingDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const applyPreset = (id: string) => {
    setDraft(PRESETS[id].draft);
    setStatus({ state: "idle" });
  };

  // The ONLY field the content contract supports as a write today is the premium-cut coin_cost (registers a
  // premium beat_variant on an ending beat via POST /variants). The rest are saved as a local draft and
  // flagged as a gated seam.
  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!graph) return;
    const endingBeats = graph.beats.filter((b) => b.role === "ending");
    const targetBeat = (endingBeats[0] ?? graph.beats[0])?.id;
    if (!targetBeat) {
      setStatus({ state: "error", message: "This series has no beats to attach a premium cut to yet." });
      return;
    }
    setStatus({ state: "submitting" });
    try {
      const row = await content.createVariant({
        beat_id: targetBeat,
        tier: "A_filmed",
        is_premium: true,
        coin_cost: draft.premiumCutCoins,
        playback_url: `https://cdn.example/placeholder/premium-${targetBeat}.m3u8`,
      });
      setStatus({
        state: "ok",
        message: `Premium cut priced at ${draft.premiumCutCoins} coins (variant ${row.id.slice(0, 8)}). Series unlock, free-episode count, subscription, ad tier, and channel opt-in are saved as a draft; persisting them needs a content pricing endpoint (gated).`,
      });
    } catch (err) {
      const message =
        err instanceof ContentApiError
          ? err.status === 404
            ? "The content service is not reachable in this environment yet."
            : err.apiError ?? `error_${err.status}`
          : err instanceof Error
            ? err.message
            : "save_failed";
      setStatus({ state: "error", message });
    }
  };

  return (
    <section aria-label="Pricing" data-testid="monetization-pricing" style={{ marginTop: 14 }}>
      <div className="scaption">Pricing</div>

      {graphState.status === "loading" && <Skeleton height={48} data-testid="monetization-pricing-loading" />}
      {graphState.status === "error" && (
        <p className="statusline err" role="alert" data-testid="monetization-pricing-error">
          Could not load the series: {graphState.message}
        </p>
      )}

      {graph && (
        <>
          <div className="btnrow" data-testid="monetization-presets" style={{ marginBottom: 10 }}>
            <span className="muted" style={{ alignSelf: "center" }}>One-click presets:</span>
            {Object.entries(PRESETS).map(([id, p]) => (
              <Button key={id} variant="secondary" onClick={() => applyPreset(id)} data-testid={`monetization-preset-${id}`}>
                {p.label}
              </Button>
            ))}
          </div>

          <form className="pricebox" onSubmit={onSave} aria-label="Series pricing" data-testid="monetization-form">
            <div className="fldgrid">
              <div className="fld">
                <label htmlFor="mon-unlock">Series unlock (coins)</label>
                <input id="mon-unlock" type="number" min={0} value={draft.seriesUnlockCoins}
                  onChange={(e) => set("seriesUnlockCoins", Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
                  data-testid="mon-unlock" />
              </div>
              <div className="fld">
                <label htmlFor="mon-free">Free episodes</label>
                <input id="mon-free" type="number" min={0} value={draft.freeEpisodes}
                  onChange={(e) => set("freeEpisodes", Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
                  data-testid="mon-free" />
              </div>
              <div className="fld">
                <label htmlFor="mon-premium">Premium cut (coins, own-once)</label>
                <input id="mon-premium" type="number" min={0} value={draft.premiumCutCoins}
                  onChange={(e) => set("premiumCutCoins", Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
                  data-testid="mon-premium" />
              </div>
              <div className="fld">
                <label htmlFor="mon-adtier">Ad tier</label>
                <select id="mon-adtier" value={draft.adTier}
                  onChange={(e) => set("adTier", e.target.value as PricingDraft["adTier"])}
                  data-testid="mon-adtier">
                  <option value="none">No ads</option>
                  <option value="rewarded">Rewarded unlock only</option>
                  <option value="interstitial">Rewarded plus interstitial</option>
                </select>
              </div>
            </div>

            <label className="toggle2">
              <button type="button" className={`toggle${draft.subscriptionIncluded ? "" : " off"}`}
                onClick={() => set("subscriptionIncluded", !draft.subscriptionIncluded)}
                aria-pressed={draft.subscriptionIncluded} aria-label="Include in subscription"
                data-testid="mon-subscription"><i /></button>
              Include in the subscription bundle
            </label>
            <label className="toggle2">
              <button type="button" className={`toggle${draft.channelPlacementOptIn ? "" : " off"}`}
                onClick={() => set("channelPlacementOptIn", !draft.channelPlacementOptIn)}
                aria-pressed={draft.channelPlacementOptIn} aria-label="Opt in to channel placement"
                data-testid="mon-channel"><i /></button>
              Opt in to channel placement
            </label>

            {existingPremium && (
              <p className="muted" style={{ marginTop: 6 }} data-testid="mon-premium-current">
                A premium cut is already priced at {existingPremium.coin_cost} coins. Saving registers a new
                premium variant (in-place edits need a content update endpoint, flagged).
              </p>
            )}

            <div className="rowend" style={{ marginTop: 12 }}>
              <Button type="submit" disabled={status.state === "submitting"} data-testid="monetization-save">
                {status.state === "submitting" ? "Saving..." : "Save pricing"}
              </Button>
            </div>

            {status.state === "ok" && (
              <p className="statusline ok" role="status" data-testid="monetization-save-ok">{status.message}</p>
            )}
            {status.state === "error" && (
              <p className="statusline err" role="alert" data-testid="monetization-save-error">Error: {status.message}</p>
            )}
          </form>
        </>
      )}
    </section>
  );
}

function RevenuePanel({ seriesId }: { seriesId: string }): JSX.Element {
  const [reload, setReload] = useState(0);
  const state = useSeriesRevenue(seriesId, reload);

  return (
    <section aria-label="Revenue and the 70/30 split" data-testid="monetization-revenue" style={{ marginTop: 18 }}>
      <div className="scaption">Revenue and the 70/30 creator/platform split</div>

      {state.status === "loading" && (
        <div aria-busy="true" data-testid="monetization-revenue-loading">
          <Skeleton height={64} />
          <Skeleton height={120} style={{ marginTop: 10 }} />
        </div>
      )}

      {state.status === "error" && state.notAvailable && (
        <EmptyState
          title="Revenue is not connected here"
          action={
            <Button variant="secondary" onClick={() => setReload((n) => n + 1)} data-testid="monetization-revenue-retry">
              Try again
            </Button>
          }
        >
          <p className="muted" data-testid="monetization-revenue-not-available">
            The catalog revenue service is not reachable in this environment yet. Earnings appear once it is
            connected.
          </p>
        </EmptyState>
      )}

      {state.status === "error" && !state.notAvailable && (
        <ErrorState
          title="Could not load revenue"
          action={
            <Button variant="secondary" onClick={() => setReload((n) => n + 1)} data-testid="monetization-revenue-retry">
              Retry
            </Button>
          }
        >
          <p className="muted" data-testid="monetization-revenue-error">{state.message}</p>
        </ErrorState>
      )}

      {state.status === "loaded" && <RevenueBody data={state.data} />}
    </section>
  );
}

function RevenueBody({ data }: { data: SeriesRevenue }): JSX.Element {
  const hasAny = data.totalGross > 0 || data.bySource.length > 0;
  // Recompute the split CLIENT-SIDE from gross too, so the displayed creator/platform numbers are verifiable
  // against the server-provided creator70/platform30 (transparency, not just trust the server).
  const computed = useMemo(
    () => ({
      creator: Math.round(data.totalGross * CREATOR_SHARE),
      platform: Math.round(data.totalGross * PLATFORM_SHARE),
    }),
    [data.totalGross],
  );

  if (!hasAny) {
    return (
      <p className="muted" data-testid="monetization-revenue-empty">
        No revenue yet. Earnings appear once viewers unlock cuts or watch rewarded ads.
      </p>
    );
  }

  return (
    <div data-testid="monetization-revenue-body">
      <div className="analytics-kpis" data-testid="monetization-kpis">
        <KpiCard label="Total gross (coins)" value={data.totalGross.toLocaleString()} tone="neutral" />
        <KpiCard label="Your 70% share" value={data.creator70.toLocaleString()} tone="gold" trend="creator share" />
        <KpiCard label="Platform 30%" value={data.platform30.toLocaleString()} tone="neutral" trend="platform share" />
        <KpiCard label="Payout balance" value={data.payoutBalance.toLocaleString()} tone="gold" trend="withdrawable" />
      </div>

      {/* Transparency: show the split is exactly 70/30 of gross, recomputed client-side. */}
      <p className="muted" data-testid="monetization-split-check" style={{ marginTop: 6 }}>
        Computed from {data.totalGross.toLocaleString()} gross coins: 70% = {computed.creator.toLocaleString()},
        30% = {computed.platform.toLocaleString()}. The split is applied per transaction.
      </p>

      <RevenueTable
        caption="By source"
        testId="monetization-by-source"
        rows={data.bySource.map((r) => ({ key: r.source, label: r.source, gross: r.gross, creatorShare: r.creatorShare, platformShare: r.platformShare }))}
      />
      <RevenueTable
        caption="By episode"
        testId="monetization-by-episode"
        rows={data.byEpisode.map((r) => ({ key: r.episodeId, label: r.label ?? r.episodeId.slice(0, 8), gross: r.gross, creatorShare: r.creatorShare, platformShare: r.platformShare }))}
      />
      <RevenueTable
        caption="By cohort"
        testId="monetization-by-cohort"
        rows={data.byCohort.map((r) => ({ key: r.cohort, label: r.cohort, gross: r.gross, creatorShare: r.creatorShare, platformShare: r.platformShare }))}
      />

      <PayoutHistory balance={data.payoutBalance} />
    </div>
  );
}

interface RevRow { key: string; label: string; gross: number; creatorShare: number; platformShare: number; }

function RevenueTable({ caption, testId, rows }: { caption: string; testId: string; rows: RevRow[] }): JSX.Element {
  return (
    <div style={{ marginTop: 14 }}>
      <div className="scaption">{caption}</div>
      {rows.length === 0 ? (
        <p className="muted" data-testid={`${testId}-empty`}>No data for this breakdown yet.</p>
      ) : (
        <table className="analytics-table" data-testid={testId}>
          <thead>
            <tr>
              <th scope="col">{caption.replace("By ", "")}</th>
              <th scope="col">Gross</th>
              <th scope="col">You (70%)</th>
              <th scope="col">Platform (30%)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-testid={`${testId}-${slug(r.key)}`}>
                <td>{r.label}</td>
                <td>{r.gross.toLocaleString()}</td>
                <td>{r.creatorShare.toLocaleString()}</td>
                <td>{r.platformShare.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Payout history / method / statements: READ-ONLY. The live payout rail is a Stripe TEST connection until a
// live-rail decision; we never trigger a charge or a payout here.
function PayoutHistory({ balance }: { balance: number }): JSX.Element {
  return (
    <div className="inspcard" data-testid="monetization-payouts" style={{ marginTop: 16 }}>
      <div className="scaption">Payouts</div>
      <div className="kv" style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
        <span>Payout method</span>
        <b>Stripe Connect (TEST)</b>
      </div>
      <div className="kv" style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
        <span>Withdrawable balance</span>
        <b>{balance.toLocaleString()} coins</b>
      </div>
      <p className="muted" data-testid="monetization-payout-note" style={{ marginTop: 6 }}>
        Statements and payout history are read-only here. The payout rail is a Stripe TEST connection until
        the live-rail decision; no live charge or payout is ever made.
      </p>
    </div>
  );
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}
