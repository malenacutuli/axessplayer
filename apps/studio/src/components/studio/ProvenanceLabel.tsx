// Provenance label shown on everything the AI generates. Two facts surfaced by construction: the asset is
// C2PA-signed (content credentials / provenance) and it carries an EU AI Act Article 50 transparency label
// ("AI generated / AI assisted"). This is not decorative: the platform signs and labels generated media at
// the factory, and the Studio MUST surface that label so the creator sees it before publishing. Built on
// the @axessplayer/ui A11yBadge (c2pa variant). No em dashes.
import { A11yBadge } from "@axessplayer/ui";

export interface ProvenanceLabelProps {
  // "generated" = fully synthetic; "assisted" = human master with AI-generated derivatives. Both are
  // disclosed under Article 50; the wording differs.
  mode?: "generated" | "assisted";
  testId?: string;
}

export function ProvenanceLabel({ mode = "generated", testId }: ProvenanceLabelProps): JSX.Element {
  const article50 = mode === "generated" ? "AI generated" : "AI assisted";
  return (
    <span className="provlabel" data-testid={testId ?? "provenance-label"} data-mode={mode}>
      <A11yBadge kind="c2pa" />
      <span className="provlabel__a50" title="EU AI Act Article 50 transparency disclosure">
        Article 50: {article50}
      </span>
    </span>
  );
}
