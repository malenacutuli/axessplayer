// TRUST / CONSENT / PROVENANCE (section 14): /admin/trust. The moat, surfaced first-class. The consent-ledger
// admin (scope / expiry / revocation, hard-delete as a gated 501 seam) from GET /admin/trust/consent, shown
// MINIMIZED: pseudonymous subject refs + scope/status/expiry + residency only; NO full biometric template or
// PII is ever returned to the console (it stays on the sovereign plane; the console sees a minimized,
// access-logged projection). C2PA status + a public-verification affordance from GET /admin/trust/provenance.
// Sovereign data-plane residency indicators (EU / Swiss). The GDPR request queue, with delete/export as
// gated 501 seams. RBAC: trust.view -> Admin / Owner (+ a compliance read for Moderation; ReadOnly mirror);
// trust.manage (consent hard-delete / GDPR run) -> Admin / Owner only, rendered disabled coming-soon.
// WCAG 2.2 AA. No emojis, no em dashes.
import { Button, ErrorState, Skeleton } from "@axessplayer/ui";
import { useTrustConsent, useTrustGdpr, useTrustProvenance } from "../api/useAdminData";
import type {
  ConsentRecord,
  ConsentScope,
  ConsentStatus,
  GdprRequestKind,
  GdprRequestState,
  ProvenanceStatus,
} from "../api/adminApi";
import { PageHead } from "./Page";
import { useRouter } from "../router/router";
import { useRole } from "../access/useRole";

const SCOPE_LABEL: Record<ConsentScope, string> = {
  likeness: "Likeness",
  voice: "Voice",
  biometric: "Biometric",
  data_processing: "Data processing",
  marketing: "Marketing",
};
const CONSENT_STATUS_LABEL: Record<ConsentStatus, string> = {
  active: "Active",
  expiring: "Expiring",
  expired: "Expired",
  revoked: "Revoked",
};
const PROV_LABEL: Record<ProvenanceStatus, string> = {
  verified: "C2PA verified",
  pending: "Pending",
  unsigned: "Unsigned",
  failed: "Verification failed",
};
const GDPR_KIND_LABEL: Record<GdprRequestKind, string> = {
  export: "Export",
  delete: "Delete",
  rectify: "Rectify",
  restrict: "Restrict",
};
const GDPR_STATE_LABEL: Record<GdprRequestState, string> = {
  received: "Received",
  in_progress: "In progress",
  awaiting_verification: "Awaiting verification",
  completed: "Completed",
  rejected: "Rejected",
};

function NoAccess() {
  const { navigate } = useRouter();
  return (
    <section className="adm-page">
      <PageHead title="Rights, consent, provenance" subtitle="Consent ledger, C2PA provenance, and data-subject rights." />
      <ErrorState
        title="Not available for your role"
        action={<Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>}
      >
        The trust and consent surface is limited to Admin and Owner roles (Moderation has a compliance read).
      </ErrorState>
    </section>
  );
}

function consentChipCls(s: ConsentStatus): string {
  if (s === "active") return "adm-pill adm-pill--ok";
  if (s === "revoked" || s === "expired") return "adm-pill adm-pill--warn";
  return "adm-pill adm-pill--warn"; // expiring
}
function provChipCls(s: ProvenanceStatus): string {
  return s === "verified" ? "adm-pill adm-pill--ok" : s === "pending" ? "adm-pill" : "adm-pill adm-pill--warn";
}

function ConsentRow({ r, canManage }: { r: ConsentRecord; canManage: boolean }) {
  return (
    <div className="adm-tr adm-tr--consent">
      <span className="adm-cell-mono">{r.subjectRef}</span>
      <span className="adm-cell-title">{SCOPE_LABEL[r.scope]}</span>
      <span className={consentChipCls(r.status)}>{CONSENT_STATUS_LABEL[r.status]}</span>
      <span className="adm-cell-muted">{r.expiresAt ?? "No expiry"}</span>
      <span className="adm-cell-mono">{r.residency}</span>
      <span>
        {canManage ? (
          <button className="adm-soon" disabled aria-disabled title="Consent hard-delete is a destructive 501 seam this wave; the attempt is audit-logged, no data is touched">Hard-delete (coming soon)</button>
        ) : (
          <span className="adm-cell-muted">Read-only</span>
        )}
      </span>
    </div>
  );
}

export function Trust() {
  const { can } = useRole();
  const consent = useTrustConsent();
  const provenance = useTrustProvenance();
  const gdpr = useTrustGdpr();
  const canManage = can("trust.manage");

  if (!can("trust.view")) return <NoAccess />;

  if (consent.loading || provenance.loading || gdpr.loading) {
    return (
      <section className="adm-page">
        <PageHead title="Rights, consent, provenance" />
        <Skeleton height={380} radius={14} />
      </section>
    );
  }
  if (!consent.data && !provenance.data && !gdpr.data) {
    return (
      <section className="adm-page">
        <PageHead title="Rights, consent, provenance" />
        <ErrorState title="Trust surface unavailable">This surface could not be loaded. Try again shortly.</ErrorState>
      </section>
    );
  }

  const source = [consent.source, provenance.source, gdpr.source].includes("demo") ? "demo" : "live";
  const res = consent.data?.residency;

  return (
    <section className="adm-page">
      <PageHead
        title="Rights, consent, provenance"
        subtitle="The sovereign trust plane: consent ledger, C2PA provenance, and data-subject rights. This is the moat."
        source={source}
      />

      {/* The minimization + sovereignty note. The console only ever sees a minimized, access-logged
          projection; full biometric data and PII never leave the sovereign plane. */}
      <div className="adm-firewall" role="note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
          <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <span>
          Sovereign data plane. The full consent record (biometric templates, raw identity) lives on the
          sovereign plane and never reaches this console. Every row below is a minimized, access-logged
          projection: pseudonymous subject reference, scope, status, expiry, and residency only.
        </span>
      </div>

      {/* Residency indicators (the moat). */}
      {res && (
        <div className="adm-residency" aria-label="Data residency posture">
          <div className="adm-residency__cell"><span className="adm-residency__k">EU residency</span><span className="adm-residency__v">{res.eu}</span></div>
          <div className="adm-residency__cell"><span className="adm-residency__k">Swiss (CH) residency</span><span className="adm-residency__v">{res.ch}</span></div>
          <div className="adm-residency__cell"><span className="adm-residency__k">US residency</span><span className="adm-residency__v">{res.us}</span></div>
        </div>
      )}

      {/* Consent ledger. */}
      {consent.data && (
        <section className="adm-card" style={{ marginTop: 14 }} aria-label="Consent ledger">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Consent ledger (minimized)</h2>
          {consent.data.records.length === 0 ? (
            <p className="adm-note">No consent records in this environment.</p>
          ) : (
            <div className="adm-table" aria-label="Consent records">
              <div className="adm-tr adm-tr--consent adm-thead">
                <span>SUBJECT</span>
                <span>SCOPE</span>
                <span>STATUS</span>
                <span>EXPIRY</span>
                <span>RESIDENCY</span>
                <span>ACTION</span>
              </div>
              {consent.data.records.map((r) => <ConsentRow key={r.id} r={r} canManage={canManage} />)}
            </div>
          )}
          <p className="adm-note" style={{ marginTop: 10 }}>
            Consent hard-delete is a destructive, RBAC-gated, audit-logged seam (Admin / Owner). It is a 501
            seam this wave: the attempt is recorded, no consent data is touched.
          </p>
        </section>
      )}

      {/* C2PA provenance. */}
      {provenance.data && (
        <section className="adm-card" style={{ marginTop: 14 }} aria-label="C2PA provenance">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>C2PA provenance</h2>
          {provenance.data.records.length === 0 ? (
            <p className="adm-note">No provenance records in this environment.</p>
          ) : (
            <div className="adm-table" aria-label="Provenance records">
              <div className="adm-tr adm-tr--prov adm-thead">
                <span>ASSET</span>
                <span>STATUS</span>
                <span>SIGNER</span>
                <span>VERIFY</span>
              </div>
              {provenance.data.records.map((p) => (
                <div key={p.id} className="adm-tr adm-tr--prov">
                  <span className="adm-cell-title">{p.assetTitle}</span>
                  <span className={provChipCls(p.status)}>{PROV_LABEL[p.status]}</span>
                  <span className="adm-cell-muted">{p.signer ?? "Unsigned"}</span>
                  <span>
                    {p.manifestId ? (
                      <span className="adm-cell-mono" title="Hand this manifest id to a public C2PA verifier">{p.manifestId}</span>
                    ) : (
                      <span className="adm-cell-muted">No manifest</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="adm-note" style={{ marginTop: 10 }}>
            Verification runs against the signed C2PA manifest. The manifest id is the public-verification
            handle an operator can hand to an external verifier; no clean verdict is fabricated.
          </p>
        </section>
      )}

      {/* GDPR request queue. */}
      {gdpr.data && (
        <section className="adm-card" style={{ marginTop: 14 }} aria-label="GDPR request queue">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>GDPR request queue</h2>
          {gdpr.data.requests.length === 0 ? (
            <p className="adm-note">No open data-subject requests.</p>
          ) : (
            <div className="adm-table" aria-label="GDPR requests">
              <div className="adm-tr adm-tr--gdpr adm-thead">
                <span>SUBJECT</span>
                <span>KIND</span>
                <span>STATE</span>
                <span>RECEIVED</span>
                <span>DUE BY</span>
                <span>ACTION</span>
              </div>
              {gdpr.data.requests.map((g) => (
                <div key={g.id} className="adm-tr adm-tr--gdpr">
                  <span className="adm-cell-mono">{g.subjectRef}</span>
                  <span className="adm-cell-title">{GDPR_KIND_LABEL[g.kind]}</span>
                  <span className={g.state === "completed" ? "adm-pill adm-pill--ok" : g.state === "rejected" ? "adm-pill adm-pill--warn" : "adm-cell-muted"}>{GDPR_STATE_LABEL[g.state]}</span>
                  <span className="adm-cell-mono">{g.receivedAt}</span>
                  <span className="adm-cell-mono">{g.dueBy}</span>
                  <span>
                    {canManage ? (
                      <button className="adm-soon" disabled aria-disabled title="GDPR delete/export run is a destructive 501 seam this wave; the attempt is audit-logged, no data is touched">Run (coming soon)</button>
                    ) : (
                      <span className="adm-cell-muted">Read-only</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="adm-note" style={{ marginTop: 10 }}>
            Running a GDPR delete or export moves and erases sovereign-plane data. It is a destructive,
            RBAC-gated, audit-logged 501 seam this wave (Admin / Owner): the attempt is recorded, no data is
            touched.
          </p>
        </section>
      )}
    </section>
  );
}
