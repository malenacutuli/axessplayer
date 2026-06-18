// GROWTH & UA (section 12): /admin/growth. The creative-test bandit win-rates (per creative arm, each as a
// win-rate BAND since it is estimated), CAC / LTV / payback by channel and cohort (LTV / CAC as bands where
// estimated), and the referral-loop health from mobile.referrals, from GET /admin/growth. Every estimated
// figure is a LiftBand (a band, never a point). RBAC: growth.view is granted to every role in the matrix
// (Marketing / Admin / Owner own it); ReadOnly sees a read-only mirror. Real loading / empty / error states.
// WCAG 2.2 AA. No emojis, no em dashes.
import { Button, EmptyState, ErrorState, LiftBand, Skeleton } from "@axessplayer/ui";
import { useGrowth } from "../api/useAdminData";
import type { CreativeArm, GrowthChannel, KpiBand, ReferralHealth } from "../api/adminApi";
import { PageHead } from "./Page";
import { useRouter } from "../router/router";
import { useRole } from "../access/useRole";

const num = (n: number) => n.toLocaleString("en-US");

function BandCell({ band }: { band: KpiBand }) {
  return <LiftBand low={band.low} high={band.high} center={band.center} label={band.label} />;
}

function armStatusTone(status: CreativeArm["status"]): string {
  if (status === "winner") return "adm-pill--ok";
  if (status === "paused") return "adm-pill--warn";
  return "";
}

function CreativeTests({ arms }: { arms: CreativeArm[] }) {
  return (
    <section className="adm-card" aria-label="Creative-test bandit win-rates">
      <h2 className="adm-card__title">Creative tests (bandit win-rates)</h2>
      <p className="adm-note">Win-rates are estimated and shown as bands, never points. Allocation is the share the bandit currently gives each arm.</p>
      <div className="adm-table" aria-label="Creative arms">
        <div className="adm-tr adm-tr--arms adm-thead">
          <span>CREATIVE</span>
          <span>CHANNEL</span>
          <span>IMPRESSIONS</span>
          <span>WIN-RATE (BAND)</span>
          <span>ALLOC</span>
          <span>STATUS</span>
        </div>
        {arms.map((a) => (
          <div key={a.id} className="adm-tr adm-tr--arms">
            <span className="adm-cell-title">{a.name}</span>
            <span className="adm-cell-muted">{a.channel}</span>
            <span className="adm-cell-mono">{num(a.impressions)}</span>
            <span><BandCell band={a.winRate} /></span>
            <span className="adm-cell-mono">{a.allocationPct}%</span>
            <span className={`adm-pill ${armStatusTone(a.status)}`}>{a.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Channels({ channels }: { channels: GrowthChannel[] }) {
  return (
    <section className="adm-card" aria-label="CAC, LTV, and payback by channel">
      <h2 className="adm-card__title">CAC / LTV / payback by channel</h2>
      <p className="adm-note">LTV is projected and shown as a band; CAC and payback are realized point figures.</p>
      <div className="adm-table" aria-label="Channels">
        <div className="adm-tr adm-tr--channels adm-thead">
          <span>CHANNEL</span>
          <span>COHORT</span>
          <span>CAC</span>
          <span>LTV (BAND)</span>
          <span>PAYBACK</span>
          <span>INSTALLS</span>
        </div>
        {channels.map((c) => (
          <div key={c.id} className="adm-tr adm-tr--channels">
            <span className="adm-cell-title">{c.channel}</span>
            <span className="adm-cell-muted">{c.cohort}</span>
            <span className="adm-cell-mono">${c.cacUsd.toFixed(2)}</span>
            <span><BandCell band={c.ltvBand} /></span>
            <span className="adm-cell-mono">{c.paybackMonths.toFixed(1)} mo</span>
            <span className="adm-cell-mono">{num(c.installs)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Referral({ referral }: { referral: ReferralHealth }) {
  return (
    <section className="adm-card" aria-label="Referral-loop health">
      <h2 className="adm-card__title">Referral-loop health</h2>
      <div className="adm-an-kpis">
        <div className="adm-card adm-an-kpi">
          <div className="adm-an-kpi__label">Invites sent</div>
          <div className="adm-an-kpi__num">{num(referral.invitesSent)}</div>
        </div>
        <div className="adm-card adm-an-kpi">
          <div className="adm-an-kpi__label">Accept rate</div>
          <div className="adm-an-kpi__num">{referral.acceptRatePct.toFixed(1)}%</div>
        </div>
        <div className="adm-card adm-an-kpi">
          <div className="adm-an-kpi__label">k-factor (projection, band)</div>
          <div className="adm-cell-muted">Estimated, shown as a band</div>
          <BandCell band={referral.kFactorBand} />
        </div>
      </div>
      <div className="adm-table" aria-label="Referral funnel" style={{ marginTop: 14 }}>
        <div className="adm-tr adm-tr--an2 adm-thead">
          <span>STEP</span>
          <span>USERS</span>
        </div>
        {referral.funnel.map((f) => (
          <div key={f.label} className="adm-tr adm-tr--an2">
            <span className="adm-cell-title">{f.label}</span>
            <span className="adm-cell-mono">{num(f.value)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Growth() {
  const { isReadOnly } = useRole();
  const { navigate } = useRouter();
  const { data, loading, error, source } = useGrowth();

  const empty =
    data && data.creativeTests.length === 0 && data.channels.length === 0 && data.referral.invitesSent === 0;

  return (
    <section className="adm-page">
      <PageHead
        title="Growth & UA"
        subtitle="Creative-test bandit win-rates, CAC / LTV / payback by channel and cohort, and referral-loop health. Estimated figures are shown as bands."
        source={source}
        right={isReadOnly ? <span className="adm-pill" title="Read-only role">Read-only</span> : undefined}
      />

      {loading && <Skeleton height={320} radius={14} />}
      {!loading && (error || !data) && (
        <ErrorState
          title="Growth unavailable"
          action={<Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>}
        >
          The growth surface could not be loaded. Try again shortly.
        </ErrorState>
      )}

      {!loading && data && empty && (
        <EmptyState title="No growth data yet">
          No creative tests, channels, or referral activity are recorded in this environment. This surface is
          routed and reachable; data appears here as acquisition and referral events accrue.
        </EmptyState>
      )}

      {!loading && data && !empty && (
        <div className="adm-growth">
          {data.creativeTests.length > 0 && <CreativeTests arms={data.creativeTests} />}
          {data.channels.length > 0 && <Channels channels={data.channels} />}
          <Referral referral={data.referral} />
        </div>
      )}
    </section>
  );
}
