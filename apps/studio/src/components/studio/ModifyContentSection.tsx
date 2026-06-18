// SECTION 11 - MODIFY CONTENT (/studio/content/:id). The post-publish edit surface for a single title. It
// loads the chosen series graph and groups the operations a creator needs after a series exists:
//
//  Wired to EXISTING content endpoints:
//    - Unpublish / republish  -> POST /series/:id/unpublish | /publish
//    - Re-run poster          -> POST /series/:id/poster/generate (regenerate the title art)
//    - Delete a draft variant -> DELETE /variants/:id
//
//  RBAC / confirmation-gated COMING-SOON seams (the endpoint is not built yet; we never fake success):
//    - Delete the whole draft series, replace the master video, upload an alt-ending / POV / premium cut,
//      enhance (re-run a single stage), re-run accessibility, change metadata / thumbnail / release date,
//      disable comments, add brand/region exclusions.
//
// EVERY destructive action opens an explicit CONFIRMATION DIALOG that states versioning and C2PA provenance
// are preserved (a delete soft-deletes a version; nothing is silently destroyed). Real loading / empty /
// error, never a dead end. Built on @axessplayer/ui (STUDIO skin). WCAG 2.2 AA. No em dashes.
import { useCallback, useState } from "react";
import { Button, ErrorState, Skeleton, StatusChip } from "@axessplayer/ui";
import { SeriesPicker } from "./SeriesPicker.js";
import { useFlatGraph } from "../../api/useFlatGraph.js";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";
import type { FlatGraph } from "../../api/flattenGraph.js";

export interface ModifyContentSectionProps {
  // The series id deep-linked in the route (#/studio/content/:id). Empty until a title is picked.
  seriesId: string;
  // Push a series id into the route so the picker selection becomes a deep link.
  onSelectSeries: (id: string) => void;
}

export function ModifyContentSection({ seriesId, onSelectSeries }: ModifyContentSectionProps): JSX.Element {
  const [reload, setReload] = useState(0);
  const graphState = useFlatGraph(seriesId, reload);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  return (
    <div className="spanel" data-testid="panel-content">
      <div className="sbar">
        <div>
          <div className="ey rose">Modify content</div>
          <h2 style={{ marginTop: 8 }}>Edit a published title</h2>
          <p className="muted">Unpublish, replace, enhance, re-run accessibility, change pricing or metadata, and more.</p>
        </div>
      </div>

      <SeriesPicker selectedId={seriesId} onSelect={onSelectSeries} label="Modify which series" />

      {!seriesId && (
        <p className="muted" data-testid="content-idle" style={{ marginTop: 12 }}>
          Pick a title to modify it. Destructive actions always confirm first and preserve versioning.
        </p>
      )}

      {seriesId && graphState.status === "loading" && (
        <div data-testid="content-loading" aria-busy="true" style={{ marginTop: 12 }}>
          <Skeleton height={48} />
          <Skeleton height={120} style={{ marginTop: 10 }} />
        </div>
      )}

      {seriesId && graphState.status === "error" && (
        <ErrorState
          title="Could not load the title"
          action={<Button variant="secondary" onClick={refresh} data-testid="content-retry">Retry</Button>}
        >
          <p className="muted" data-testid="content-error">{graphState.message}</p>
        </ErrorState>
      )}

      {seriesId && graphState.status === "loaded" && (
        <ModifyBody graph={graphState.graph} onChanged={refresh} />
      )}
    </div>
  );
}

type Pending =
  | null
  | {
      kind: "unpublish" | "publish" | "regenerate-poster";
      title: string;
      body: string;
      destructive: boolean;
      run: () => Promise<string>;
    }
  | {
      kind: "seam";
      title: string;
      body: string;
      destructive: boolean;
      seam: string;
    }
  | {
      kind: "delete-variant";
      title: string;
      body: string;
      destructive: boolean;
      variantId: string;
      run: () => Promise<string>;
    };

function ModifyBody({ graph, onChanged }: { graph: FlatGraph; onChanged: () => void }): JSX.Element {
  const content = useContentClient();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const isPublished = Boolean(graph.publishedAt);
  const premiumDrafts = graph.variants.filter((v) => v.is_premium);

  const onConfirm = useCallback(async () => {
    if (!pending) return;
    setResult(null);
    if (pending.kind === "seam") {
      setPending(null);
      setResult({
        ok: false,
        message: `Coming soon: "${pending.title}" needs a content endpoint that is not built yet (${pending.seam}). Nothing was changed; versioning and provenance are untouched.`,
      });
      return;
    }
    setBusy(true);
    try {
      const message = await pending.run();
      setResult({ ok: true, message });
      onChanged();
    } catch (err) {
      const message =
        err instanceof ContentApiError
          ? err.status === 404
            ? "The content service is not reachable in this environment yet."
            : err.apiError ?? `error_${err.status}`
          : err instanceof Error
            ? err.message
            : "action_failed";
      setResult({ ok: false, message });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }, [pending, onChanged]);

  return (
    <div data-testid="content-body" style={{ marginTop: 12 }}>
      <div className="inspcard" data-testid="content-summary">
        <div className="scaption">{graph.seriesTitle}</div>
        <div className="kv" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
          <StatusChip status={isPublished ? "live" : "draft"} />
          <span className="muted">{graph.beats.length} beats - {graph.variants.length} variants - {premiumDrafts.length} premium</span>
        </div>
      </div>

      {result && (
        <p
          className={`statusline ${result.ok ? "ok" : ""}`}
          role={result.ok ? "status" : "alert"}
          data-testid="content-result"
          style={{ marginTop: 10 }}
        >
          {result.message}
        </p>
      )}

      {/* Publish state. */}
      <ActionGroup title="Publishing">
        {isPublished ? (
          <ActionButton
            testId="content-unpublish"
            destructive
            label="Unpublish"
            blurb="Hide from the feed. The series and all versions are preserved."
            onClick={() =>
              setPending({
                kind: "unpublish",
                title: "Unpublish this title",
                body: "It will be removed from the public feed. Nothing is deleted: all beats, variants, and versions are preserved and you can republish anytime.",
                destructive: true,
                run: async () => {
                  await content.unpublishSeries(graph.seriesId);
                  return "Unpublished. The title is hidden from the feed; all versions are preserved.";
                },
              })
            }
          />
        ) : (
          <ActionButton
            testId="content-publish"
            label="Publish"
            blurb="Make this title visible in the feed."
            onClick={() =>
              setPending({
                kind: "publish",
                title: "Publish this title",
                body: "It will appear in the public feed. You can unpublish again at any time.",
                destructive: false,
                run: async () => {
                  await content.publishSeries(graph.seriesId);
                  return "Published. The title is now visible in the feed.";
                },
              })
            }
          />
        )}
        <ActionButton
          testId="content-delete-series"
          destructive
          label="Delete draft series"
          blurb="Soft-delete the whole draft. Endpoint not built yet."
          onClick={() =>
            setPending({
              kind: "seam",
              title: "Delete this draft series",
              body: "This soft-deletes the series as a new version; provenance and prior versions are retained so it can be restored. The delete-series endpoint is not built yet.",
              destructive: true,
              seam: "DELETE /series/:id",
            })
          }
        />
      </ActionGroup>

      {/* Video + cuts. */}
      <ActionGroup title="Video and cuts">
        <ActionButton
          testId="content-replace-video"
          destructive
          label="Replace master video"
          blurb="Swap the master. The prior cut is kept as a version."
          onClick={() =>
            setPending({
              kind: "seam",
              title: "Replace the master video",
              body: "The new master is encoded and registered as a new version. The previous cut and its C2PA provenance are preserved so the swap is reversible. The replace endpoint is not built yet.",
              destructive: true,
              seam: "PUT /variants/:id/video",
            })
          }
        />
        <ActionButton
          testId="content-upload-alt"
          label="Upload alt ending / POV / premium cut"
          blurb="Add a new merchandised cut. Endpoint not built yet."
          onClick={() =>
            setPending({
              kind: "seam",
              title: "Upload an alternate cut",
              body: "Adds an alternate ending, POV, or premium cut as a new variant. Existing cuts are untouched. The cut-upload endpoint is not built yet.",
              destructive: false,
              seam: "POST /variants (alt cut upload)",
            })
          }
        />
      </ActionGroup>

      {/* Enhance + re-run. */}
      <ActionGroup title="Enhance and re-run">
        <ActionButton
          testId="content-enhance"
          label="Enhance (re-run a stage)"
          blurb="Re-run a single production stage. Endpoint not built yet."
          onClick={() =>
            setPending({
              kind: "seam",
              title: "Re-run a production stage",
              body: "Re-runs one stage (for example key frames or dialogue) and registers the output as a new version; the prior output is preserved. The re-run endpoint is not built yet.",
              destructive: false,
              seam: "POST /series/:id/stages/:stage/rerun",
            })
          }
        />
        <ActionButton
          testId="content-rerun-accessibility"
          label="Re-run accessibility"
          blurb="Regenerate captions / AD / sign / dub. Endpoint not built yet."
          onClick={() =>
            setPending({
              kind: "seam",
              title: "Re-run accessibility",
              body: "Re-runs the accessibility factory (captions, audio description, sign, dub). New tracks are added as versions; prior tracks are preserved. The studio re-run seam is not wired here.",
              destructive: false,
              seam: "POST /series/:id/produce (accessibility)",
            })
          }
        />
        <ActionButton
          testId="content-rerun-poster"
          label="Re-run poster"
          blurb="Regenerate the title art (wired)."
          onClick={() =>
            setPending({
              kind: "regenerate-poster",
              title: "Regenerate the poster",
              body: "Generates a new AI poster (C2PA-signed, Article 50 labelled) and sets it on the series. The previous poster URL is retained in provenance.",
              destructive: false,
              run: async () => {
                await content.generateSeriesPoster(
                  graph.seriesId,
                  `${graph.seriesTitle}. Cinematic vertical movie poster, dramatic lighting. No text.`,
                );
                return "Regenerated the poster. The new art is C2PA-signed and Article 50 labelled.";
              },
            })
          }
        />
      </ActionGroup>

      {/* Metadata. */}
      <ActionGroup title="Metadata and settings">
        <ActionButton
          testId="content-change-metadata"
          label="Change pricing / metadata / thumbnail / release date"
          blurb="Edit title metadata. Endpoint not built yet."
          onClick={() =>
            setPending({
              kind: "seam",
              title: "Change metadata",
              body: "Edits pricing, metadata, thumbnail, or release date. Changes are versioned so prior values can be restored. The metadata patch endpoint is not built yet.",
              destructive: false,
              seam: "PATCH /series/:id (metadata)",
            })
          }
        />
        <ActionButton
          testId="content-disable-comments"
          label="Disable comments"
          blurb="Turn off comments for this title. Endpoint not built yet."
          onClick={() =>
            setPending({
              kind: "seam",
              title: "Disable comments",
              body: "Turns off comments for this title. Existing comments are hidden, not deleted, so the setting is reversible. The comments setting endpoint is not built yet.",
              destructive: false,
              seam: "PATCH /series/:id (comments_enabled)",
            })
          }
        />
        <ActionButton
          testId="content-brand-region"
          label="Add brand / region exclusions"
          blurb="Block brands or regions. Endpoint not built yet."
          onClick={() =>
            setPending({
              kind: "seam",
              title: "Add brand or region exclusions",
              body: "Excludes specific brands (ad firewall) or regions (rights) from this title. Stored as a versioned policy. The exclusions endpoint is not built yet.",
              destructive: false,
              seam: "PATCH /series/:id (exclusions)",
            })
          }
        />
      </ActionGroup>

      {/* Delete a premium draft variant (wired DELETE /variants/:id). */}
      <ActionGroup title="Premium variants">
        {premiumDrafts.length === 0 ? (
          <p className="muted" data-testid="content-no-premium">No premium variants on this title yet.</p>
        ) : (
          <ul className="varlist" data-testid="content-variant-list">
            {premiumDrafts.map((v) => (
              <li key={v.id} className="varrow" data-testid={`content-variant-${v.id}`}>
                <span className="varrow__name">Premium cut - {v.coin_cost} coins ({v.id.slice(0, 8)})</span>
                <Button
                  variant="secondary"
                  className="axp-btn--danger"
                  data-testid={`content-delete-variant-${v.id}`}
                  onClick={() =>
                    setPending({
                      kind: "delete-variant",
                      title: "Delete this premium variant",
                      body: "The variant is removed. Provenance and any prior versions are preserved; viewers who already own it keep their entitlement.",
                      destructive: true,
                      variantId: v.id,
                      run: async () => {
                        await content.deleteVariant(v.id);
                        return `Deleted variant ${v.id.slice(0, 8)}. Provenance is preserved.`;
                      },
                    })
                  }
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </ActionGroup>

      <div className="note">
        <span className="notetag">SAFE BY DEFAULT</span>
        Every destructive action confirms first and is versioned: deletes soft-delete a version, replacements
        keep the prior cut, and C2PA provenance is retained. Nothing is silently destroyed.
      </div>

      {pending && (
        <ConfirmDialog pending={pending} busy={busy} onCancel={() => setPending(null)} onConfirm={() => void onConfirm()} />
      )}
    </div>
  );
}

function ActionGroup({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section aria-label={title} className="actiongroup" style={{ marginTop: 14 }}>
      <div className="scaption">{title}</div>
      <div className="actiongroup__items">{children}</div>
    </section>
  );
}

function ActionButton({
  label,
  blurb,
  onClick,
  destructive,
  testId,
}: {
  label: string;
  blurb: string;
  onClick: () => void;
  destructive?: boolean;
  testId: string;
}): JSX.Element {
  return (
    <div className={destructive ? "actioncard danger" : "actioncard"} data-testid={`${testId}-card`}>
      <div className="actioncard__text">
        <b>{label}</b>
        <span className="muted">{blurb}</span>
      </div>
      <Button
        variant="secondary"
        className={destructive ? "axp-btn--danger" : undefined}
        onClick={onClick}
        data-testid={testId}
      >
        {label}
      </Button>
    </div>
  );
}

// Accessible confirmation dialog. Every destructive action routes through here and the body states that
// versioning / provenance is preserved. role=dialog + aria-modal, focus is moved to the dialog on open.
function ConfirmDialog({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: NonNullable<Pending>;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <div className="modal-scrim" role="presentation" onClick={onCancel} data-testid="content-confirm-scrim">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-confirm-title"
        aria-describedby="content-confirm-body"
        data-testid="content-confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="content-confirm-title" className="modal__title">{pending.title}</h3>
        <p id="content-confirm-body" className="modal__body">{pending.body}</p>
        <p className="modal__provenance" data-testid="content-confirm-provenance">
          Versioning and C2PA provenance are preserved.
        </p>
        <div className="rowend" style={{ marginTop: 14, gap: 10, display: "flex", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onCancel} disabled={busy} data-testid="content-confirm-cancel">
            Cancel
          </Button>
          <Button
            className={pending.destructive ? "axp-btn--danger" : undefined}
            onClick={onConfirm}
            disabled={busy}
            data-testid="content-confirm-go"
            autoFocus
          >
            {busy ? "Working..." : pending.destructive ? "Yes, continue" : "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  );
}
