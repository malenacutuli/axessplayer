// ACCESSIBILITY FACTORY (/admin/accessibility). Its own section, from GET /admin/accessibility. A readiness
// meter (the shared Meter component) per series, the per-track / per-language QA matrix (CWI captions, audio
// description, sign, dub), and the Deaf-review queue. The readiness score gates publish: a series under the
// threshold shows its blockers and a "publish blocked" note. Accept / Edit / Upload-human-clip review
// actions are RBAC-gated (accessibility.review: Moderation/Content/Admin/Owner); the review-action endpoint
// is not served yet, so they render DISABLED with a "coming soon" hint and would emit an audited action when
// wired (no dead end). No personal/biometric data lives on this surface. WCAG 2.2 AA. No emojis, no em dashes.
import { Meter, ErrorState, Skeleton } from "@axessplayer/ui";
import { useAccessibility } from "../api/useAdminData";
import type { PerTrackRow, QaStatus, TrackKind } from "../api/adminApi";
import { PageHead } from "./Page";
import { useRole } from "../access/useRole";

const PUBLISH_THRESHOLD = 95;

const TRACK_LABEL: Record<TrackKind, string> = {
  captions: "Captions (CWI)",
  audio_description: "Audio description",
  sign: "Sign",
  dub: "Dub",
};
const QA_LABEL: Record<QaStatus, string> = {
  ready: "Ready",
  in_qa: "In QA",
  drafted: "Drafted",
  missing: "Missing",
  failed: "Failed",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function AccessibilityFactory() {
  const { data, loading, error, source } = useAccessibility();
  const { can } = useRole();
  const canReview = can("accessibility.review");

  if (loading) {
    return (
      <section className="adm-page">
        <PageHead title="Accessibility factory" />
        <Skeleton height={420} radius={14} />
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="adm-page">
        <PageHead title="Accessibility factory" />
        <ErrorState title="Unavailable">Accessibility readiness could not be loaded. Try again shortly.</ErrorState>
      </section>
    );
  }

  // Group the per-track matrix by series for a readable table.
  const trackBySeries = new Map<string, PerTrackRow[]>();
  for (const r of data.perTrack) {
    const arr = trackBySeries.get(r.seriesTitle) ?? [];
    arr.push(r);
    trackBySeries.set(r.seriesTitle, arr);
  }

  return (
    <section className="adm-page">
      <PageHead
        title="Accessibility factory"
        subtitle="Captions, audio description, sign, and dubs across every variant. The readiness score gates publish."
        right={!canReview ? <span className="adm-pill" title="Read-only role">Read-only</span> : undefined}
        source={source}
      />

      {/* Readiness meters, one per series, with publish gate + blockers. */}
      <section className="adm-card" aria-label="Publish readiness">
        <h2 className="adm-card__title" style={{ marginBottom: 14 }}>Publish readiness</h2>
        <div className="adm-readiness">
          {data.readiness.map((r) => {
            const blocked = r.score < PUBLISH_THRESHOLD;
            return (
              <div key={r.seriesId} className="adm-readiness__row">
                <div className="adm-readiness__head">
                  <span className="adm-cell-title">{r.seriesTitle}</span>
                  <span className={`adm-readiness__score ${blocked ? "is-blocked" : "is-ready"}`}>{r.score}%</span>
                </div>
                <Meter value={r.score} label={`${r.seriesTitle} accessibility readiness`} />
                {blocked ? (
                  <div className="adm-readiness__blockers">
                    <span className="adm-note adm-note--warn">Publish blocked (under {PUBLISH_THRESHOLD}%)</span>
                    <ul className="adm-rules">
                      {r.blockers.map((b, i) => (
                        <li key={i} className="adm-rules__row">{b}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="adm-note adm-note--ok">Ready to publish.</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Per-track / per-language QA matrix. */}
      <section className="adm-table" style={{ marginTop: 14 }} aria-label="Per-track QA status">
        <div className="adm-tr adm-thead adm-tr--track">
          <span>SERIES</span>
          <span>TRACK</span>
          <span>LANGUAGE</span>
          <span>QA STATUS</span>
          <span>COVERAGE</span>
        </div>
        {data.perTrack.map((r, i) => (
          <div key={`${r.seriesId}-${r.track}-${r.language}-${i}`} className="adm-tr adm-tr--track">
            <span className="adm-cell-title">{r.seriesTitle}</span>
            <span>{TRACK_LABEL[r.track]}</span>
            <span className="adm-cell-mono">{r.language}</span>
            <span><span className={`adm-qa adm-qa--${r.status}`}>{QA_LABEL[r.status]}</span></span>
            <span className="adm-cell-mono">{r.coverage}%</span>
          </div>
        ))}
      </section>

      {/* Deaf-review queue. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Deaf review queue">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Deaf-review queue</h2>
        {data.reviewQueue.length === 0 ? (
          <p className="adm-note">The review queue is empty. Sign and dub drafts awaiting human review appear here.</p>
        ) : (
          <ul className="adm-reviewq">
            {data.reviewQueue.map((item) => (
              <li key={item.id} className="adm-reviewq__row">
                <div>
                  <div className="adm-cell-title">{item.seriesTitle} · {item.episodeTitle}</div>
                  <div className="adm-cell-muted">
                    {TRACK_LABEL[item.track]} · {item.language} · {item.reviewer} · submitted {fmtDate(item.submittedAt)}
                  </div>
                </div>
                {canReview && (
                  <div className="adm-reviewq__actions">
                    <button className="adm-soon" disabled aria-disabled title="Review-action endpoint arrives in a later wave">Accept (coming soon)</button>
                    <button className="adm-soon" disabled aria-disabled title="Review-action endpoint arrives in a later wave">Edit (coming soon)</button>
                    <button className="adm-soon" disabled aria-disabled title="Upload-clip endpoint arrives in a later wave">Upload clip (coming soon)</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
