// SETTINGS & ROLES (section 17): /admin/settings. This is overwhelmingly a READ surface. It shows: the RBAC
// role matrix VIEW (the 8 roles x capabilities, read-only display from the rbac policy in src/access/rbac.ts,
// never editable here); the immutable admin audit trail VIEW (a paged list from GET /admin/settings/audit,
// which is empty with a clear note when the audit table is not yet applied); the integrations status list;
// the feature flags (each toggle is an RBAC-gated coming-soon seam, no write this wave); and an env-config
// panel that STATES secrets live in the platform env store ONLY and are never shown or edited here. Founder
// sign-off items (reward-function weights) are display-only with the standing note.
//
// RBAC: settings.view -> Owner / Admin (the role matrix, integrations, flags, env panel). The audit-trail
// read (settings.view_audit) is broad: every role can read it for accountability, even when they cannot see
// the rest of the settings surface. Real loading / empty / error states; no dead end. WCAG 2.2 AA. No
// emojis, no em dashes.
import { useState } from "react";
import { Button, ErrorState, Skeleton } from "@axessplayer/ui";
import { useSettings, useSettingsAudit } from "../api/useAdminData";
import type { IntegrationStatus, RoleCapability } from "../api/adminApi";
import { PageHead } from "./Page";
import { useRouter } from "../router/router";
import { useRole } from "../access/useRole";

const CAP_LABEL: Record<RoleCapability, string> = { full: "Full", manage: "Manage", read: "Read", none: "-" };
const INTEGRATION_LABEL: Record<IntegrationStatus, string> = {
  connected: "Connected",
  test_mode: "Test mode",
  not_configured: "Not configured",
  degraded: "Degraded",
};
const INTEGRATION_PILL: Record<IntegrationStatus, string> = {
  connected: "adm-pill adm-pill--ok",
  test_mode: "adm-pill adm-pill--warn",
  not_configured: "adm-cell-muted",
  degraded: "adm-pill adm-pill--down",
};
const OUTCOME_LABEL: Record<string, string> = {
  executed: "Executed",
  seam_501: "Gated 501 (recorded)",
  denied: "Denied",
};

// The immutable admin audit trail. A broad-read surface (settings.view_audit) shown to every role for
// accountability. It is rendered even when settings.view is denied, so an operator who cannot see the rest
// of settings can still see what was done.
function AuditTrail() {
  const [cursor] = useState<string | undefined>(undefined);
  const { data, loading, error } = useSettingsAudit(cursor);

  return (
    <section className="adm-card" style={{ marginTop: 14 }} aria-label="Admin audit trail">
      <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Immutable admin audit trail</h2>
      {loading ? (
        <Skeleton height={180} radius={12} />
      ) : error || !data ? (
        <ErrorState title="Audit trail unavailable">The audit trail could not be loaded. Try again shortly.</ErrorState>
      ) : !data.tableApplied ? (
        <p className="adm-note adm-note--warn">
          The immutable audit table has not been applied to the hosted database yet, so there are no entries
          to show. Once applied, every admin mutation appends an append-only, tamper-evident row here. The UI
          never edits or deletes an entry.
        </p>
      ) : data.entries.length === 0 ? (
        <p className="adm-note">No audit entries in this window. Mutations append rows here as they occur.</p>
      ) : (
        <>
          <div className="adm-table" aria-label="Audit entries">
            <div className="adm-tr adm-tr--audit adm-thead">
              <span>WHEN</span>
              <span>OPERATOR</span>
              <span>ROLE</span>
              <span>ACTION</span>
              <span>TARGET</span>
              <span>OUTCOME</span>
            </div>
            {data.entries.map((e) => (
              <div key={e.id} className="adm-tr adm-tr--audit">
                <span className="adm-cell-mono">{e.at}</span>
                <span className="adm-cell-title">{e.actor}</span>
                <span className="adm-cell-muted">{e.role}</span>
                <span className="adm-cell-mono">{e.action}</span>
                <span className="adm-cell-muted">{e.target}</span>
                <span
                  className={
                    e.outcome === "executed"
                      ? "adm-pill adm-pill--ok"
                      : e.outcome === "denied"
                        ? "adm-pill adm-pill--down"
                        : "adm-pill adm-pill--warn"
                  }
                >
                  {OUTCOME_LABEL[e.outcome] ?? e.outcome}
                </span>
              </div>
            ))}
          </div>
          <p className="adm-note" style={{ marginTop: 10 }}>
            The trail is append-only and tamper-evident; entries are never edited or deleted from this console.
            Targets are display labels only, never personal or biometric data.
          </p>
        </>
      )}
    </section>
  );
}

function NoSettingsAccess() {
  const { navigate } = useRouter();
  return (
    <section className="adm-page">
      <PageHead
        title="Settings & roles"
        subtitle="The RBAC role matrix, integrations, feature flags, and the immutable admin audit trail."
      />
      <div className="adm-alert adm-alert--warn" role="note">
        The settings surface (role matrix, integrations, feature flags, env config) is limited to Owner and
        Admin roles. The immutable admin audit trail below is readable by every role for accountability.
      </div>
      <AuditTrail />
      <div style={{ marginTop: 14 }}>
        <Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>
      </div>
    </section>
  );
}

export function Settings() {
  const { can } = useRole();
  const canManage = can("settings.manage");

  // settings.view is Owner / Admin only. A role without it still gets the broad audit-trail read.
  if (!can("settings.view")) return <NoSettingsAccess />;

  return <SettingsFull canManage={canManage} />;
}

function SettingsFull({ canManage }: { canManage: boolean }) {
  const { data, loading, error, source } = useSettings();

  if (loading) {
    return (
      <section className="adm-page">
        <PageHead title="Settings & roles" />
        <Skeleton height={420} radius={14} />
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="adm-page">
        <PageHead title="Settings & roles" />
        <ErrorState title="Settings unavailable">The settings surface could not be loaded. Try again shortly.</ErrorState>
      </section>
    );
  }

  return (
    <section className="adm-page">
      <PageHead
        title="Settings & roles"
        subtitle="The RBAC role matrix, integrations, feature flags, the env-config policy, and the immutable admin audit trail."
        source={source}
      />

      {/* RBAC role matrix VIEW. Read-only, derived from the rbac policy. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Role matrix">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Role matrix (read-only)</h2>
        <div className="adm-matrix-scroll">
          <div className="adm-matrix" role="table" aria-label="Roles by capability">
            <div className="adm-matrix__row adm-matrix__head" role="row">
              <span role="columnheader">CAPABILITY</span>
              {data.roles.map((r) => (
                <span key={r} role="columnheader" style={{ textAlign: "center" }}>{r}</span>
              ))}
            </div>
            {data.capabilities.map((cap) => (
              <div key={cap.key} className="adm-matrix__row" role="row">
                <span className="adm-cell-title" role="cell">{cap.label}</span>
                {data.roles.map((r) => {
                  const c = cap.byRole[r];
                  return (
                    <span key={r} className={`adm-cap adm-cap--${c}`} role="cell" aria-label={`${r}: ${CAP_LABEL[c]}`}>
                      {CAP_LABEL[c]}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="adm-note" style={{ marginTop: 10 }}>
          The matrix mirrors the server-enforced RBAC policy; it is a read-only view, not an editor. The
          server enforces RBAC on every endpoint and audit-logs every mutation. Reward-function weights are
          a founder sign-off, never an operator/agent action, so they are read-only for every role.
        </p>
      </section>

      <div className="adm-two-col" style={{ marginTop: 14 }}>
        {/* Integrations list. */}
        <section className="adm-card" aria-label="Integrations">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Integrations</h2>
          <ul className="adm-historylist">
            {data.integrations.map((it) => (
              <li key={it.key} className="adm-historylist__row">
                <span>
                  <span className="adm-cell-title">{it.name}</span>
                  <span className="adm-flag__desc">{it.description}</span>
                </span>
                <span className={INTEGRATION_PILL[it.status]}>{INTEGRATION_LABEL[it.status]}</span>
                <span className="adm-cell-muted">
                  {canManage ? (
                    <button
                      className="adm-soon"
                      disabled
                      aria-disabled
                      title="Editing an integration is an RBAC-gated, audit-logged seam this wave; secrets are never entered here"
                    >
                      Configure (coming soon)
                    </button>
                  ) : (
                    "Read-only"
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="adm-note" style={{ marginTop: 10 }}>
            Secret credentials for every integration live in the platform env store only and are never shown
            or entered here.
          </p>
        </section>

        {/* Feature flags. */}
        <section className="adm-card" aria-label="Feature flags">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Feature flags</h2>
          {data.featureFlags.map((f) => (
            <div key={f.key} className="adm-flag">
              <span className="adm-flag__meta">
                <span className="adm-flag__name">{f.label}</span>
                <span className="adm-flag__desc">{f.description}</span>
              </span>
              <span>
                {f.founderGated ? (
                  <span className="adm-pill adm-pill--lock" title="A founder sign-off, never an operator/agent action">
                    Founder sign-off
                  </span>
                ) : canManage ? (
                  <button
                    className="adm-soon"
                    disabled
                    aria-disabled
                    title="Toggling a flag is an RBAC-gated, audit-logged seam this wave; nothing is written"
                  >
                    {f.enabled ? "On" : "Off"} (coming soon)
                  </button>
                ) : (
                  <span className={f.enabled ? "adm-pill adm-pill--ok" : "adm-cell-muted"}>{f.enabled ? "On" : "Off"}</span>
                )}
              </span>
            </div>
          ))}
          <p className="adm-note" style={{ marginTop: 10 }}>
            Toggling a flag is an RBAC-gated, audit-logged seam (Owner / Admin) and ships in a later wave;
            founder-gated flags stay read-only for everyone, including Owner / Admin.
          </p>
        </section>
      </div>

      {/* Env-config policy panel. NEVER shows or edits a secret value. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Environment configuration">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Environment configuration</h2>
        <div className="adm-alert adm-alert--warn" role="note">
          Secrets live in the platform env store ONLY. No secret value is ever shown or edited from this
          console. This panel lists the configuration keys the platform reads; values are managed in the
          deploy platform, not here.
        </div>
        <div style={{ marginTop: 12 }}>
          {data.envKeys.map((k) => (
            <div key={k.key} className="adm-envkey">
              <span className="adm-envkey__name">{k.key}</span>
              <span className="adm-envkey__desc">{k.description}</span>
              <span className={k.secret ? "adm-pill adm-pill--lock" : "adm-cell-muted"}>
                {k.secret ? "Secret (platform store)" : "Public config"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <AuditTrail />
    </section>
  );
}
