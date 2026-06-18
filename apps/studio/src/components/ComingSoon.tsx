// A reachable coming-soon surface for studio sections that are not built yet. The route is real and
// linkable (no dead end): it explains the section's intent and routes the creator back to a built surface
// so they are never stuck. Built on the @axessplayer/ui design system (EmptyState). No em dashes.
import { Button, EmptyState } from "@axessplayer/ui";
import type { SectionId, StudioSection } from "../sections.js";

export interface ComingSoonProps {
  section: StudioSection;
  onNavigate: (section: SectionId) => void;
}

export function ComingSoon({ section, onNavigate }: ComingSoonProps): JSX.Element {
  return (
    <div className="spanel" data-testid={`panel-${section.id}`}>
      <div className="sbar">
        <div>
          <div className="ey rose">Coming soon</div>
          <h2 style={{ marginTop: 8 }}>{section.label}</h2>
        </div>
      </div>
      <EmptyState
        title={`${section.label} is on the way`}
        action={
          <Button variant="secondary" data-testid="coming-soon-back" onClick={() => onNavigate("dashboard")}>
            Back to dashboard
          </Button>
        }
      >
        <p className="muted" data-testid={`coming-soon-${section.id}`}>
          {section.blurb}
        </p>
      </EmptyState>
    </div>
  );
}
