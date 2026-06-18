// MONETIZATION (section 10): /admin/monetization. The pricing-rules engine, configurable by
// country / platform / content-type / experiment-cohort, covering credit packs, subscriptions, trials,
// rewarded ads, premium / alt-ending / POV / intensity pricing, promo codes, regional pricing, tax / VAT,
// refunds, and chargebacks, from GET /admin/monetization. Rules are READ this wave: create / edit are
// RBAC-gated (Finance / Admin / Owner) disabled coming-soon SEAMS; nothing here writes. The reward-function
// weights panel is DISPLAY-ONLY with a visible "changing these is a founder sign-off, not an operator
// action" note and NO edit control. Stripe is in TEST mode (a badge says so). RBAC: monetization.view is
// every role; the edit seams need Finance / Admin / Owner; ReadOnly sees a read-only mirror. WCAG 2.2 AA.
// No emojis, no em dashes.
import { Button, EmptyState, ErrorState, Skeleton } from "@axessplayer/ui";
import { useMonetization } from "../api/useAdminData";
import type { MonetizationRule, MonetizationRuleKind, OperatorRole } from "../api/adminApi";
import { PageHead } from "./Page";
import { useRouter } from "../router/router";
import { useRole } from "../access/useRole";

const KIND_LABEL: Record<MonetizationRuleKind, string> = {
  credit_pack: "Credit pack",
  subscription: "Subscription",
  trial: "Trial",
  rewarded_ad: "Rewarded ad",
  premium_cut: "Premium cut",
  alt_ending: "Alt ending",
  pov: "POV",
  intensity: "Intensity",
  promo_code: "Promo code",
  regional: "Regional",
  tax_vat: "Tax / VAT",
  refund: "Refund",
  chargeback: "Chargeback",
};

// The rule groups, in the order the engine surfaces them. Each group is one card with its own table.
const GROUPS: Array<{ title: string; kinds: MonetizationRuleKind[] }> = [
  { title: "Credit packs", kinds: ["credit_pack"] },
  { title: "Subscriptions and trials", kinds: ["subscription", "trial"] },
  { title: "Ads", kinds: ["rewarded_ad"] },
  { title: "Premium content pricing", kinds: ["premium_cut", "alt_ending", "pov", "intensity"] },
  { title: "Promotions", kinds: ["promo_code"] },
  { title: "Regional pricing", kinds: ["regional"] },
  { title: "Tax, refunds, and chargebacks", kinds: ["tax_vat", "refund", "chargeback"] },
];

// Roles that may eventually create / edit a pricing rule (seam is disabled this wave).
const EDIT_ROLES: OperatorRole[] = ["Finance", "Admin", "Owner"];

function StripeBadge({ mode }: { mode: "test" | "live" }) {
  return (
    <span className={`adm-stripe adm-stripe--${mode}`} title={mode === "test" ? "Stripe is in TEST mode: no live charges" : "Stripe live"}>
      Stripe {mode === "test" ? "TEST" : "LIVE"}
    </span>
  );
}

function ruleStatusTone(status: MonetizationRule["status"]): string {
  if (status === "active") return "adm-pill--ok";
  if (status === "paused") return "adm-pill--warn";
  return "";
}

function RuleTable({ rules, canEdit }: { rules: MonetizationRule[]; canEdit: boolean }) {
  if (rules.length === 0) return null;
  return (
    <div className="adm-table" aria-label="Pricing rules">
      <div className="adm-tr adm-tr--rules adm-thead">
        <span>RULE</span>
        <span>KIND</span>
        <span>PRICE</span>
        <span>COUNTRY</span>
        <span>PLATFORM</span>
        <span>CONTENT</span>
        <span>COHORT</span>
        <span>STATUS</span>
      </div>
      {rules.map((r) => (
        <div key={r.id} className="adm-tr adm-tr--rules">
          <span className="adm-cell-title">
            {r.name}
            {r.note && <span className="adm-cell-muted" style={{ display: "block" }}>{r.note}</span>}
          </span>
          <span className="adm-cell-muted">{KIND_LABEL[r.kind]}</span>
          <span className="adm-cell-mono">{r.price}</span>
          <span className="adm-cell-mono">{r.country}</span>
          <span className="adm-cell-mono">{r.platform}</span>
          <span className="adm-cell-mono">{r.contentType}</span>
          <span className="adm-cell-mono">{r.cohort}</span>
          <span className={`adm-pill ${ruleStatusTone(r.status)}`}>{r.status}</span>
        </div>
      ))}
      {/* Edit / create is an RBAC-gated, audit-logged SEAM. Disabled coming-soon: nothing writes this wave. */}
      <div className="adm-rules__foot">
        <button
          className="adm-soon"
          disabled
          aria-disabled
          title={canEdit ? "Pricing edits are an audit-logged seam, wired in a later wave" : "Pricing edits require a Finance, Admin, or Owner role"}
        >
          {canEdit ? "Add / edit rule (coming soon)" : "Editing limited to Finance, Admin, Owner"}
        </button>
      </div>
    </div>
  );
}

// The reward-function weights. DISPLAY ONLY for every role. There is NO edit control; changing a weight is a
// founder sign-off, not an operator/agent action, and the note says so.
function RewardWeightsPanel({ weights }: { weights: Array<{ key: string; label: string; value: string; signal: string }> }) {
  return (
    <section className="adm-card adm-reward" aria-label="Reward-function weights (display only)">
      <div className="adm-reward__head">
        <h2 className="adm-card__title">Reward-function weights</h2>
        <span className="adm-pill adm-pill--lock" title="Display only">Display only</span>
      </div>
      <p className="adm-note adm-note--warn" role="note">
        Changing these is a founder sign-off, not an operator action. They are shown read-only; there is no
        edit control on this surface.
      </p>
      <div className="adm-table" aria-label="Reward weights">
        <div className="adm-tr adm-tr--reward adm-thead">
          <span>WEIGHT</span>
          <span>SIGNAL</span>
          <span>VALUE</span>
        </div>
        {weights.map((w) => (
          <div key={w.key} className="adm-tr adm-tr--reward">
            <span className="adm-cell-title">{w.label}</span>
            <span className="adm-cell-mono">{w.signal}</span>
            <span className="adm-cell-mono">{w.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Monetization() {
  const { role, isReadOnly } = useRole();
  const { navigate } = useRouter();
  const { data, loading, error, source } = useMonetization();
  const canEdit = !isReadOnly && EDIT_ROLES.includes(role);

  return (
    <section className="adm-page">
      <PageHead
        title="Monetization"
        subtitle="Pricing-rules engine by country, platform, content type, and experiment cohort. Read-only this wave; edits are an audit-logged seam."
        source={source}
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {data && <StripeBadge mode={data.stripeMode} />}
            {isReadOnly && <span className="adm-pill" title="Read-only role">Read-only</span>}
          </div>
        }
      />

      {loading && <Skeleton height={320} radius={14} />}
      {!loading && (error || !data) && (
        <ErrorState
          title="Monetization unavailable"
          action={<Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>}
        >
          The pricing configuration could not be loaded. Try again shortly.
        </ErrorState>
      )}

      {!loading && data && (
        <>
          {data.rules.length === 0 ? (
            <EmptyState title="No pricing rules yet">
              No pricing rules are configured in this environment. This surface is routed and reachable; rules
              appear here once the pricing engine is seeded.
            </EmptyState>
          ) : (
            <div className="adm-rule-groups">
              {GROUPS.map((g) => {
                const rules = data.rules.filter((r) => g.kinds.includes(r.kind));
                if (rules.length === 0) return null;
                return (
                  <section key={g.title} className="adm-card" aria-label={g.title}>
                    <h2 className="adm-card__title">{g.title}</h2>
                    <RuleTable rules={rules} canEdit={canEdit} />
                  </section>
                );
              })}
            </div>
          )}

          <RewardWeightsPanel weights={data.rewardWeights} />
        </>
      )}
    </section>
  );
}
