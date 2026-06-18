// CI gate: render the gallery React tree to static HTML, load it into jsdom, run axe-core, print any
// violations, and exit non-zero if any serious or critical violation exists.
//
// Run from packages/ui:
//   node --import tsx --import ./gallery/css-stub.mjs gallery/axe-audit.ts
//
// The css-stub loader maps the design-system .css imports to empty modules so this React tree can be
// imported under Node. jsdom has NO layout or paint, so rules that need geometry (notably
// color-contrast) cannot be evaluated here and are disabled below. Color-contrast is verified against
// the DEPLOYED gallery (Vercel preview), which has real layout. No em dashes.
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import axe from "axe-core";
import { Gallery } from "./gallery";

async function main(): Promise<void> {
  const html = renderToStaticMarkup(React.createElement(Gallery));
  const dom = new JSDOM(
    `<!doctype html><html lang="en"><head><title>Axessplayer UI Gallery</title></head><body>${html}</body></html>`,
  );

  const { window } = dom;
  // axe-core runs against a DOM. Point its globals at the jsdom window.
  (globalThis as unknown as { window: unknown }).window = window;
  (globalThis as unknown as { document: unknown }).document = window.document;
  (globalThis as unknown as { Node: unknown }).Node = window.Node;

  const results = await axe.run(window.document.documentElement, {
    // jsdom has no layout, so geometry-dependent rules cannot be evaluated reliably here.
    rules: {
      "color-contrast": { enabled: false },
    },
  });

  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  const minor = results.violations.filter(
    (v) => v.impact !== "serious" && v.impact !== "critical",
  );

  const print = (label: string, list: typeof results.violations) => {
    if (list.length === 0) return;
    console.log(`\n${label}`);
    for (const v of list) {
      console.log(`  [${v.impact ?? "unknown"}] ${v.id}: ${v.help}`);
      console.log(`    ${v.helpUrl}`);
      for (const node of v.nodes) {
        console.log(`    target: ${node.target.join(" ")}`);
      }
    }
  };

  console.log(
    `axe audit: ${results.passes.length} checks passed, ${results.violations.length} violation type(s) found.`,
  );
  print("Minor / moderate violations (not gating):", minor);
  print("Serious / critical violations (GATING):", serious);

  if (serious.length > 0) {
    console.error(
      `\nFAIL: ${serious.length} serious/critical accessibility violation type(s). Fix before merge.`,
    );
    process.exit(1);
  }

  console.log("\nPASS: no serious/critical accessibility violations.");
  process.exit(0);
}

main().catch((err) => {
  console.error("axe audit crashed:", err);
  process.exit(1);
});
