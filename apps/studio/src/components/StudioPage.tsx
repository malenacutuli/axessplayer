// StudioPage: the authoring workspace shell, matching the "Studio" section of the brand prototype. A left
// rail ("axess studio" + nav) and a main area that shows one of five panels: Library, Branch editor,
// Media & variants, Pricing, Publish. The active series (the real seeded "The Last Signal" by default) is
// loaded once as a FLATTENED graph (beat_id re-stamped onto every variant) and shared across the panels.
// A successful create bumps a reload token so the graph refreshes. No em dashes.
import { useCallback, useState } from "react";
import { SideRail, type PanelId } from "./studio/SideRail.js";
import { LibraryPanel } from "./studio/LibraryPanel.js";
import { BranchEditorPanel } from "./studio/BranchEditorPanel.js";
import { MediaPanel } from "./studio/MediaPanel.js";
import { PosterPanel } from "./studio/PosterPanel.js";
import { PricingPanel } from "./studio/PricingPanel.js";
import { PublishPanel } from "./studio/PublishPanel.js";
import { useFlatGraph } from "../api/useFlatGraph.js";
import { LAST_SIGNAL_SERIES_ID } from "../api/knownSeries.js";

export function StudioPage(): JSX.Element {
  const [panel, setPanel] = useState<PanelId>("library");
  // Default to the real seeded series so the studio is wired to live content on first paint.
  const [seriesId, setSeriesId] = useState<string>(LAST_SIGNAL_SERIES_ID);
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
    [reload],
  );

  const selectBeat = useCallback((beatId: string) => setSelectedBeatId(beatId), []);

  return (
    <div className="studio-shell">
      <div className="studio-wrap">
        <div className="studio">
          <SideRail active={panel} onSelect={setPanel} />
          <div className="smain">
            {panel === "library" && <LibraryPanel onOpenSeries={openSeries} />}

            {panel !== "library" && graphState.status === "loading" && (
              <p className="muted" data-testid="graph-loading">
                Loading graph...
              </p>
            )}
            {panel !== "library" && graphState.status === "error" && (
              <p role="alert" className="statusline err" data-testid="graph-error">
                Could not load graph: {graphState.message}
              </p>
            )}
            {panel !== "library" && graphState.status === "idle" && (
              <p className="muted" data-testid="graph-idle">
                Open a series from the Library to start.
              </p>
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
        </div>
      </div>
    </div>
  );
}
