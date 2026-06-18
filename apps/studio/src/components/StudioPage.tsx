// StudioPage: the authoring workspace shell, matching the "Studio" section of the brand prototype. A left
// rail ("axess studio" + nav) and a main area that shows one of five panels: Library, Branch editor,
// Media & variants, Pricing, Publish. The active series (the real seeded "The Last Signal" by default) is
// loaded once as a FLATTENED graph (beat_id re-stamped onto every variant) and shared across the panels.
// A successful create bumps a reload token so the graph refreshes. No em dashes.
//
// CONTROLLED MODE: when the Creator Studio shell drives the workflow it passes an external `panel` +
// `onPanelChange` and `hideRail`, so the shell's 14-section rail is the only rail. With NO props the page
// keeps its original behavior (its own SideRail, internal panel state, default "library"), so the existing
// integration test that renders <StudioPage /> directly stays green.
import { useCallback, useState } from "react";
import { SideRail, type PanelId } from "./studio/SideRail.js";
import { LibraryPanel } from "./studio/LibraryPanel.js";
import { BranchEditorPanel } from "./studio/BranchEditorPanel.js";
import { MediaPanel } from "./studio/MediaPanel.js";
import { PosterPanel } from "./studio/PosterPanel.js";
import { PricingPanel } from "./studio/PricingPanel.js";
import { PublishPanel } from "./studio/PublishPanel.js";
import { OperatorPanel } from "./studio/OperatorPanel.js";
import { ProducePanel } from "./studio/ProducePanel.js";
import { useFlatGraph } from "../api/useFlatGraph.js";

export interface StudioPageProps {
  // Controlled active panel. When provided, the shell owns navigation and the internal SideRail is hidden.
  panel?: PanelId;
  onPanelChange?: (panel: PanelId) => void;
  // Hide the legacy in-workspace SideRail (the Creator Studio shell provides the 14-section rail instead).
  hideRail?: boolean;
}

export function StudioPage({ panel: controlledPanel, onPanelChange, hideRail }: StudioPageProps = {}): JSX.Element {
  const [internalPanel, setInternalPanel] = useState<PanelId>("library");
  const panel = controlledPanel ?? internalPanel;
  const setPanel = useCallback(
    (next: PanelId) => {
      setInternalPanel(next);
      onPanelChange?.(next);
    },
    [onPanelChange],
  );
  // No series loaded until the author opens one from the Library (which lists the real published series).
  // Empty id keeps the graph idle, so the Studio never tries to load a series that is not in the schema.
  const [seriesId, setSeriesId] = useState<string>("");
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);
  const graphState = useFlatGraph(seriesId, reloadToken);

  const openSeries = useCallback(
    (id: string | undefined) => {
      if (id) {
        setSeriesId(id);
        setSelectedBeatId(null);
        reload();
      }
      setPanel("branch");
    },
    [reload, setPanel],
  );

  const selectBeat = useCallback((beatId: string) => setSelectedBeatId(beatId), []);

  // In controlled/embedded mode the shell renders its own 14-section rail and the surrounding chrome, so the
  // workspace is just the main column. Standalone (no props) keeps the original shell + SideRail unchanged.
  const main = (
    <>
      {!hideRail && <SideRail active={panel} onSelect={setPanel} />}
      <div className="smain">
            {panel === "library" && <LibraryPanel onOpenSeries={openSeries} />}

            {panel === "operator" && <OperatorPanel />}

            {panel !== "library" && panel !== "operator" && graphState.status === "loading" && (
              <p className="muted" data-testid="graph-loading">
                Loading graph...
              </p>
            )}
            {panel !== "library" && panel !== "operator" && graphState.status === "error" && (
              <p role="alert" className="statusline err" data-testid="graph-error">
                Could not load graph: {graphState.message}
              </p>
            )}
            {panel !== "library" && panel !== "operator" && graphState.status === "idle" && (
              <p className="muted" data-testid="graph-idle">
                Open a series from the Library to start.
              </p>
            )}

            {panel === "produce" && graphState.status === "loaded" && (
              <ProducePanel graph={graphState.graph} />
            )}
            {panel === "branch" && graphState.status === "loaded" && (
              <BranchEditorPanel
                seriesId={seriesId}
                graph={graphState.graph}
                selectedBeatId={selectedBeatId}
                onSelectBeat={selectBeat}
                onCreated={reload}
                onGoToMedia={() => setPanel("media")}
              />
            )}
            {panel === "media" && graphState.status === "loaded" && (
              <MediaPanel
                graph={graphState.graph}
                selectedBeatId={selectedBeatId}
                onSelectBeat={selectBeat}
                onCreated={reload}
                onGoToPricing={() => setPanel("pricing")}
                onGoToPublish={() => setPanel("publish")}
              />
            )}
            {panel === "poster" && graphState.status === "loaded" && (
              <PosterPanel graph={graphState.graph} onPosterSet={reload} />
            )}
            {panel === "pricing" && graphState.status === "loaded" && (
              <PricingPanel
                graph={graphState.graph}
                onCreated={reload}
                onGoToPublish={() => setPanel("publish")}
              />
            )}
            {panel === "publish" && graphState.status === "loaded" && (
              <PublishPanel graph={graphState.graph} onPublished={reload} />
            )}
      </div>
    </>
  );

  // Embedded: the shell wraps the workspace, so return just the columns it expects.
  if (hideRail) {
    return main;
  }
  // Standalone: the original full-bleed studio shell (unchanged for the existing test + direct mounting).
  return (
    <div className="studio-shell">
      <div className="studio-wrap">
        <div className="studio">{main}</div>
      </div>
    </div>
  );
}
