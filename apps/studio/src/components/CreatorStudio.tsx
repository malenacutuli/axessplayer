// CreatorStudio: the top-level Creator Studio shell (prompt 22). It owns creator auth, the 14-section left
// rail, hash routing, and renders the active section. Built surfaces:
//   - Dashboard  : the at-a-glance home (DashboardHome)
//   - Create     : the Simple-mode produce journey (StudioPage "produce")
//   - Library    : the real published series grid (StudioPage "library")
//   - Branch     : the branching graph editor (StudioPage "branch")
//   - Media      : upload + variants (StudioPage "media")
//   - Poster     : poster generate/set (StudioPage "poster")
//   - Analytics  : the live aggregates console (StudioPage "operator")
//   - Monetization : premium pricing + payout (StudioPage "pricing")
//   - Settings   : account + tier + mode
// Not-yet-built sections (Accessibility, Brand, Channel, Team, Rights) are reachable COMING-SOON routes, so
// the rail is never a dead end. The authoring workflow is the existing StudioPage, driven in CONTROLLED mode
// (its own SideRail hidden, this rail is the only one). When signed out, the AuthShell is the whole screen.
// Built on the @axessplayer/ui STUDIO skin. No em dashes.
import { useCallback, useMemo } from "react";
import { SkinScope } from "@axessplayer/ui";
import { StudioPage } from "./StudioPage.js";
import { StudioRail } from "./StudioRail.js";
import { DashboardHome } from "./DashboardHome.js";
import { ComingSoon } from "./ComingSoon.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { CreateWithAiPanel } from "./studio/CreateWithAiPanel.js";
import { UploadPanel } from "./studio/UploadPanel.js";
import { ProcessPanel } from "./studio/ProcessPanel.js";
import { sectionById, type SectionId } from "../sections.js";
import { useStudioRoute } from "../router.js";
import { useCreatorAuth } from "../auth/creatorAuth.js";
import { AuthShell } from "./AuthShell.js";
import type { PanelId } from "./studio/SideRail.js";

// Sections that are served by the existing StudioPage authoring workflow, mapped to its internal panel id.
// Sections 3-5 (create, upload, process) are NOT in here: they render dedicated panels below.
const WORKFLOW_PANEL: Partial<Record<SectionId, PanelId>> = {
  library: "library",
  branch: "branch",
  media: "media",
  poster: "poster",
  analytics: "operator",
  monetization: "pricing",
};

// Sections that render their own dedicated panel here (not the StudioPage workflow, not coming-soon). The
// coming-soon fallback must skip these so a built section never shows a coming-soon surface.
const DEDICATED_SECTIONS = new Set<SectionId>(["dashboard", "settings", "create", "upload", "process"]);

export function CreatorStudio(): JSX.Element {
  const { session, mode } = useCreatorAuth();
  const { section, navigate } = useStudioRoute();

  // The route is the single source of truth for the active section; the workflow panel is derived from it.
  const onSelect = useCallback((id: SectionId) => navigate(id), [navigate]);

  // Keep the rail highlight honest: if the workflow navigates internally (e.g. Library opens Branch), reflect
  // that back onto the route so the rail and URL track the visible panel.
  const onWorkflowPanelChange = useCallback(
    (panel: PanelId) => {
      const sectionForPanel = (Object.keys(WORKFLOW_PANEL) as SectionId[]).find(
        (key) => WORKFLOW_PANEL[key] === panel,
      );
      if (sectionForPanel) navigate(sectionForPanel);
    },
    [navigate],
  );

  const resolved = useMemo(() => sectionById(section) ?? sectionById("dashboard")!, [section]);

  // Signed out: the auth shell is the entire surface.
  if (!session) {
    return <AuthShell />;
  }

  // A pro-only section reached while in Simple mode falls back to the dashboard (the rail hides it, but a
  // deep link should not dead-end on a hidden route).
  const proGated = resolved.proOnly && mode !== "pro";
  const active = proGated ? sectionById("dashboard")! : resolved;
  const workflow = WORKFLOW_PANEL[active.id];

  return (
    <SkinScope skin="studio">
      <div className="studio-shell">
        <div className="studio-wrap">
          <div className="studio">
            <StudioRail active={active.id} onSelect={onSelect} />
            {active.id === "dashboard" && (
              <div className="smain">
                <DashboardHome onNavigate={onSelect} />
              </div>
            )}
            {active.id === "settings" && (
              <div className="smain">
                <SettingsPanel />
              </div>
            )}
            {active.id === "create" && (
              <div className="smain">
                <CreateWithAiPanel onNavigate={onSelect} />
              </div>
            )}
            {active.id === "upload" && (
              <div className="smain">
                <UploadPanel proMode={mode === "pro"} onNavigate={onSelect} />
              </div>
            )}
            {active.id === "process" && (
              <div className="smain">
                <ProcessPanel />
              </div>
            )}
            {workflow && (
              <StudioPage hideRail panel={workflow} onPanelChange={onWorkflowPanelChange} />
            )}
            {!workflow && !DEDICATED_SECTIONS.has(active.id) && (
              <div className="smain">
                <ComingSoon section={active} onNavigate={onSelect} />
              </div>
            )}
          </div>
        </div>
      </div>
    </SkinScope>
  );
}
