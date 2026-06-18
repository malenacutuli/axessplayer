// Per-user rate limiting for UGC writes (hard gate, prompt 20-V8). A fixed-window counter keyed by
// (userId, action). When a viewer exceeds the per-window budget the write is refused with 429 BEFORE it
// reaches the moderation pipeline, so a flood cannot saturate the scanner or the queue.
//
// The limiter is an injected port so production can swap the in-memory window for a shared store (Redis).
// The in-memory implementation is sufficient for a single instance and for tests. No em dashes.

export interface RateLimiter {
  // Returns true when the action is allowed (and consumes one unit), false when the per-window budget is
  // exhausted. action is a coarse bucket, e.g. "post" or "comment".
  allow(userId: string, action: string): boolean;
}

export interface FixedWindowConfig {
  // Max allowed actions per window, per (userId, action).
  limit: number;
  // Window length in milliseconds.
  windowMs: number;
}

// In-memory fixed-window limiter. Each (userId, action) tracks a window start and a count; when the window
// elapses the count resets. A clock is injectable so tests are deterministic.
export class FixedWindowRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly cfg: FixedWindowConfig,
    private readonly now: () => number = () => Date.now(),
  ) {}

  allow(userId: string, action: string): boolean {
    const key = `${userId}:${action}`;
    const t = this.now();
    const w = this.windows.get(key);
    if (w == null || t - w.start >= this.cfg.windowMs) {
      this.windows.set(key, { start: t, count: 1 });
      return true;
    }
    if (w.count >= this.cfg.limit) {
      return false;
    }
    w.count += 1;
    return true;
  }
}
