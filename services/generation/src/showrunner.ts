// Prompt 09 / showrunner: a premise expands into a beat-graph (beats + variants + edges + canon_facts) via
// an injected writers-room (the LLM). Hero content gets a human approval checkpoint BEFORE any generation
// spend. The graph is validated by a canon constraint check before it can be registered: edges must link
// real beats, a successor's canon_facts must not contradict its predecessor, and every beat needs at least
// one variant on a controllable axis. No em dashes.

export type VariantSpec = { id: string; axis: string; value: string }; // controllable axis: pace/tone/cliffhanger
export type BeatSpec = { id: string; role: string; canonFacts: Record<string, string>; variants: VariantSpec[] };
export type EdgeSpec = { from: string; to: string; condition: Record<string, unknown> };
export type BeatGraph = { premise: string; beats: BeatSpec[]; edges: EdgeSpec[] };

// The writers-room port: an LLM expands a premise into a beat-graph. Injected so tests are deterministic
// and a model swap is a config change.
export interface WritersRoom {
  expand(premise: string): Promise<BeatGraph>;
}

export type ValidationResult = { ok: boolean; errors: string[] };

// Canon constraint validation. A re-cut must never break continuity, so an edge's successor cannot assert a
// canon fact that contradicts the predecessor's value for the same key.
export function validateBeatGraph(graph: BeatGraph): ValidationResult {
  const errors: string[] = [];
  const byId = new Map(graph.beats.map((b) => [b.id, b]));
  if (graph.beats.length === 0) errors.push("graph has no beats");
  for (const b of graph.beats) {
    if (b.variants.length === 0) errors.push(`beat ${b.id} has no variants`);
  }
  for (const e of graph.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from) errors.push(`edge from unknown beat ${e.from}`);
    if (!to) errors.push(`edge to unknown beat ${e.to}`);
    if (from && to) {
      for (const [k, v] of Object.entries(to.canonFacts)) {
        if (k in from.canonFacts && from.canonFacts[k] !== v) {
          errors.push(`canon contradiction on edge ${e.from}->${e.to}: ${k} ${from.canonFacts[k]} vs ${v}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export type ShowrunResult = { graph: BeatGraph; valid: ValidationResult; approvalRequired: boolean };

// Expand a premise, validate it, and flag whether a human approval checkpoint is required before generation
// spend (hero content). The caller does not spend on an invalid graph or an unapproved hero graph.
export async function showrun(premise: string, room: WritersRoom, opts: { hero?: boolean } = {}): Promise<ShowrunResult> {
  const graph = await room.expand(premise);
  const valid = validateBeatGraph(graph);
  return { graph, valid, approvalRequired: opts.hero === true };
}
