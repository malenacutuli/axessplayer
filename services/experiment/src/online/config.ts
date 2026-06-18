// Tunables for the ONLINE experiment serving tier (Slice B). Engineering defaults, isolated here so a
// change is one line, not a code hunt. The reward-weights gate is NOT here: it lives in bandit-core.ts
// (REWARD_WEIGHTS_SIGNED_OFF, a founder decision). No em dashes.

// Default salt namespacing every experiment's deterministic bucketing. Rotating this reshuffles ALL
// assignment, so treat it as stable. Per-experiment salts can override at the call site.
export const ASSIGNMENT_SALT = "experiment-v1";

// Epsilon for the epsilon-greedy explore rate. Engineering default. While unsigned this only controls
// how often the core explores uniformly; it cannot make the exploit branch reward-sensitive.
export const DEFAULT_EPSILON = 0.1;

// Number of integer buckets for A/B assignment. 10000 gives 0.01 percent granularity on split points.
export const BUCKET_COUNT = 10000;

// The default TCP port for the online experiment listener. Slice B port. Overridable via PORT.
export const DEFAULT_PORT = 8098;
