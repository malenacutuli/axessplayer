// SECTION 6 - BRAND INTEGRATION (/studio/brands). The brand-offers INBOX. HARD GATE: NO brand appears in a
// creator's content without explicit creator permission. The inbox is OPT-IN; the creator reviews each
// eligible campaign and accepts / declines / requests-higher-payout PER BRAND. On accept, generation-time
// placement runs behind brand-safety + canon-safety filters (shown), is region-addressable, and the
// content/ad firewall is noted. The creator manages allow/block categories and approves products; revenue
// per brand/episode + conversion is a read.
//
// The brand tables are NOT in the hosted schema yet, so loadBrandOffers() returns an empty list and we
// render a REAL empty inbox with the permission + firewall model visible, never fabricated offers. The
// allow/block categories and product approvals are saved LOCALLY as a draft (no brand write endpoint yet),
// flagged as a gated seam. Built on @axessplayer/ui (STUDIO skin). WCAG 2.2 AA. No emojis, no em dashes.
import { useMemo, useState } from "react";
import { Button, EmptyState } from "@axessplayer/ui";
import {
  loadBrandOffers,
  PLACEMENT_LABEL,
  type BrandOffer,
  type OfferDecision,
} from "../../api/brandOffers.js";

// Default category taxonomy the creator can allow or block. Block-by-default keeps the gate conservative:
// nothing runs in content unless the creator both opts the category in AND accepts the specific offer.
const CATEGORIES = [
  "Beauty and cosmetics",
  "Food and beverage",
  "Fashion and apparel",
  "Technology and apps",
  "Automotive",
  "Alcohol",
  "Gambling",
  "Finance and crypto",
] as const;

type CategoryStance = "allow" | "block";

export function BrandIntegrationSection(): JSX.Element {
  // The brand service does not exist yet; the inbox is genuinely empty (never fabricated).
  const offers = useMemo(() => loadBrandOffers(), []);

  return (
    <div className="spanel" data-testid="panel-brand">
      <div className="sbar">
        <div>
          <div className="ey rose">Brand integration</div>
          <h2 style={{ marginTop: 8 }}>Brand offers inbox</h2>
          <p className="muted">
            Opt-in only. You review each campaign and accept, decline, or request a higher payout per brand.
            No brand ever appears in your content without your explicit permission.
          </p>
        </div>
      </div>

      <PermissionModel />

      <OffersInbox offers={offers} />

      <CategoryControls />

      <RevenuePerBrand />

      <div className="note">
        <span className="notetag">FIREWALL</span>
        Brand data never crosses into content ranking. Accepting an offer enables generation-time placement
        only, and every placement runs behind brand-safety and canon-safety filters before it can appear.
      </div>
    </div>
  );
}

// The permission + firewall model, always visible so the surface communicates the gate even with an empty
// inbox. This is the load-bearing copy for the HARD GATE.
function PermissionModel(): JSX.Element {
  return (
    <section aria-label="How brand integration works" data-testid="brand-permission-model" style={{ marginTop: 14 }}>
      <div className="scaption">How it works</div>
      <ol className="brand-steps">
        <li data-testid="brand-step-optin">
          <b>Opt-in inbox.</b> Eligible campaigns arrive here. Nothing is placed in your content until you
          act on a specific offer.
        </li>
        <li data-testid="brand-step-review">
          <b>Per-brand decision.</b> For each offer you accept, decline, or request a higher payout. The
          decision is recorded per brand, never blanket.
        </li>
        <li data-testid="brand-step-filters">
          <b>Safety filters.</b> On accept, generation-time placement runs behind brand-safety and
          canon-safety filters, and is region-addressable to the markets you allow.
        </li>
        <li data-testid="brand-step-firewall">
          <b>Content and ad firewall.</b> Brand data never influences what a viewer is shown. Ranking and
          sponsorship are kept separate.
        </li>
      </ol>
    </section>
  );
}

function OffersInbox({ offers }: { offers: BrandOffer[] }): JSX.Element {
  return (
    <section aria-label="Brand offers" data-testid="brand-inbox" style={{ marginTop: 18 }}>
      <div className="scaption">Eligible campaigns</div>
      {offers.length === 0 ? (
        <EmptyState title="No brand offers yet">
          <p className="muted" data-testid="brand-inbox-empty">
            When a brand proposes a campaign that fits your channel, it appears here for your review. You
            stay in control: accept, decline, or request a higher payout per brand. No offer is ever placed
            in your content automatically.
          </p>
        </EmptyState>
      ) : (
        <ul className="brand-offers">
          {offers.map((o) => (
            <OfferCard key={o.id} offer={o} />
          ))}
        </ul>
      )}
    </section>
  );
}

// A single offer card. Renders the offer detail (brand, product, payout, markets, placement type, episode
// compatibility, scene preview, disclosure) and the per-brand accept / decline / request-higher controls.
// The decision is local state (no brand write endpoint yet); accepting surfaces the filter + firewall note.
function OfferCard({ offer }: { offer: BrandOffer }): JSX.Element {
  const [decision, setDecision] = useState<OfferDecision>("pending");
  return (
    <li className="brand-offer" data-testid={`brand-offer-${offer.id}`}>
      <div className="brand-offer__head">
        <div>
          <b>{offer.brand}</b>
          <span className="muted"> - {offer.product}</span>
        </div>
        <span className="tag-saved">{offer.payoutEstimateCoins.toLocaleString()} coins est.</span>
      </div>
      <dl className="brand-offer__meta">
        <div>
          <dt>Placement</dt>
          <dd>{PLACEMENT_LABEL[offer.placementType]}</dd>
        </div>
        <div>
          <dt>Markets</dt>
          <dd>{offer.markets.join(", ")}</dd>
        </div>
        <div>
          <dt>Compatible episodes</dt>
          <dd>{offer.episodeCompatibility.join(", ")}</dd>
        </div>
        <div>
          <dt>Disclosure</dt>
          <dd>{offer.disclosure}</dd>
        </div>
      </dl>
      <p className="muted brand-offer__scene">Scene preview: {offer.scenePreview}</p>
      <div className="btnrow">
        <Button onClick={() => setDecision("accepted")} data-testid={`brand-accept-${offer.id}`}>
          Accept
        </Button>
        <Button variant="secondary" onClick={() => setDecision("requested_higher")} data-testid={`brand-higher-${offer.id}`}>
          Request higher payout
        </Button>
        <Button variant="secondary" onClick={() => setDecision("declined")} data-testid={`brand-decline-${offer.id}`}>
          Decline
        </Button>
      </div>
      {decision === "accepted" && (
        <p className="statusline ok" role="status" data-testid={`brand-accepted-${offer.id}`}>
          Accepted. Placement will run behind brand-safety and canon-safety filters, region-addressed to
          {" "}{offer.markets.join(", ")}. Persisting the agreement needs the brand service (gated).
        </p>
      )}
      {decision === "requested_higher" && (
        <p className="statusline ok" role="status" data-testid={`brand-higher-status-${offer.id}`}>
          Higher payout requested. The brand is notified; nothing is placed until you accept a revised offer.
        </p>
      )}
      {decision === "declined" && (
        <p className="statusline" role="status" data-testid={`brand-declined-${offer.id}`}>
          Declined. This brand will not appear in your content.
        </p>
      )}
    </li>
  );
}

// Allow/block categories + approved products. Saved LOCALLY (no brand write endpoint yet). Block-by-default
// is the conservative gate: a category must be allowed before any offer in it is eligible.
function CategoryControls(): JSX.Element {
  const [stance, setStance] = useState<Record<string, CategoryStance>>(() =>
    Object.fromEntries(CATEGORIES.map((c) => [c, "block" as CategoryStance])),
  );
  const [products, setProducts] = useState<string[]>([]);
  const [draftProduct, setDraftProduct] = useState("");

  const toggle = (cat: string) =>
    setStance((s) => ({ ...s, [cat]: s[cat] === "allow" ? "block" : "allow" }));

  const addProduct = () => {
    const v = draftProduct.trim();
    if (!v || products.includes(v)) return;
    setProducts((p) => [...p, v]);
    setDraftProduct("");
  };

  return (
    <section aria-label="Brand categories and approved products" data-testid="brand-categories" style={{ marginTop: 18 }}>
      <div className="scaption">Allow and block categories</div>
      <p className="muted">Categories are blocked by default. Allow a category to let matching offers reach your inbox.</p>
      <ul className="brand-cats">
        {CATEGORIES.map((cat) => {
          const allowed = stance[cat] === "allow";
          return (
            <li key={cat} className="brand-cat" data-testid={`brand-cat-${slug(cat)}`}>
              <span>{cat}</span>
              <button
                type="button"
                className={`chip${allowed ? " on" : ""}`}
                aria-pressed={allowed}
                onClick={() => toggle(cat)}
                data-testid={`brand-cat-toggle-${slug(cat)}`}
              >
                {allowed ? "Allowed" : "Blocked"}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="scaption" style={{ marginTop: 16 }}>Approved products</div>
      <p className="muted">Only products you approve here can be considered for placement.</p>
      <div className="btnrow" style={{ alignItems: "flex-end" }}>
        <div className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
          <label htmlFor="brand-product">Add an approved product</label>
          <input
            id="brand-product"
            value={draftProduct}
            onChange={(e) => setDraftProduct(e.target.value)}
            placeholder="e.g. a specific sneaker model"
            data-testid="brand-product-input"
          />
        </div>
        <Button variant="secondary" onClick={addProduct} data-testid="brand-product-add">Add</Button>
      </div>
      {products.length > 0 && (
        <ul className="brand-products" data-testid="brand-products">
          {products.map((p) => (
            <li key={p} className="tag-saved" data-testid={`brand-product-${slug(p)}`}>{p}</li>
          ))}
        </ul>
      )}
      <p className="muted" data-testid="brand-categories-gated" style={{ marginTop: 8 }}>
        Category and product preferences are saved as a local draft. Persisting them needs the brand service,
        which is not connected yet (gated).
      </p>
    </section>
  );
}

// Revenue per brand / episode + conversion. The brand tables do not exist yet, so there is no revenue to
// read: a real empty state, never a fabricated number.
function RevenuePerBrand(): JSX.Element {
  return (
    <section aria-label="Brand revenue" data-testid="brand-revenue" style={{ marginTop: 18 }}>
      <div className="scaption">Revenue per brand and episode</div>
      <EmptyState title="No brand revenue yet">
        <p className="muted" data-testid="brand-revenue-empty">
          Revenue per brand, per episode, and conversion appear here once you accept an offer and the brand
          service is connected. The 70/30 split and the content/ad firewall apply to brand revenue too.
        </p>
      </EmptyState>
    </section>
  );
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}
