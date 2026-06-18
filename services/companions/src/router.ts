// Model router port for companion chat. A companion turn is an LLM completion grounded in the character
// persona + the per-user session memory. This service NEVER hardcodes a model vendor: it depends on the
// ModelRouter port, exactly as services/generation depends on its injected MediaBackend port (the cost-gated
// model boundary). Production injects a real router (the platform model router that chooses Claude / another
// model per policy); tests inject a deterministic fake. No em dashes.
//
// HARD RULE (never fabricate): an UNWIRED router NEVER returns a turn. The default router throws, so a
// misconfigured deploy fails loud instead of silently emitting an un-grounded or un-provenanced turn. Only a
// wired router ever produces content, and every produced turn is then C2PA-signed + Article-50 labeled by
// the provenance module before it is persisted or returned.

export interface CompletionMessage {
  role: "user" | "companion";
  content: string;
}

export interface CompletionRequest {
  // The grounding system prompt built from the character persona (persona.ts). The model is bound to this.
  system: string;
  // Prior turns for this session (the per-user memory window) plus the new user turn, oldest first.
  messages: CompletionMessage[];
}

export interface CompletionResult {
  // The assistant turn text. Never fabricated by the default router.
  content: string;
  // The model id that produced it, surfaced for the provenance claim. Never a hardcoded vendor literal here;
  // the wired router reports whatever model it actually routed to.
  model: string;
}

// The injected port. There is intentionally NO default real implementation that talks to a vendor: the
// default throws (see defaultModelRouter) so an unwired deploy cannot silently spend or emit content.
export interface ModelRouter {
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class ModelRouterUnwiredError extends Error {
  constructor() {
    super("companions: no model router wired; refusing to fabricate a companion turn");
    this.name = "ModelRouterUnwiredError";
  }
}

// The default router is UNWIRED: every call throws. Production replaces this with a real platform model
// router via dependency injection. This keeps the vendor choice a policy concern, not a hardcoded import.
export function defaultModelRouter(): ModelRouter {
  return {
    async complete(): Promise<CompletionResult> {
      throw new ModelRouterUnwiredError();
    },
  };
}
