// Quartile tracker for viewership events. Fed with (position, duration) from the player's timeUpdate
// ticks, it reports each milestone at most once per playthrough:
//   play      on the first update after start (or after reset)
//   quartile  25, 50, 75 when CROSSED BY PLAYBACK (a forward seek past a quartile does not credit it)
//   complete  once, at >= 98% reached by playback or on an explicit ended()
//   seek      when the position jumps by more than seekThresholdMs from the expected position
// reset() starts a new playthrough (the shorts feed loops a video). No em dashes.

export type TrackerEvent =
  | { type: "play"; position_ms: number }
  | { type: "quartile"; position_ms: number; value: 25 | 50 | 75 }
  | { type: "complete"; position_ms: number }
  | { type: "seek"; position_ms: number; value: number };

export interface QuartileTrackerOptions {
  // Max forward gap between two ticks still treated as continuous playback.
  seekThresholdMs?: number;
  completeFraction?: number;
}

const QUARTILES = [25, 50, 75] as const;

export class QuartileTracker {
  private readonly seekThresholdMs: number;
  private readonly completeFraction: number;
  private last: number | null = null;
  private started = false;
  private completed = false;
  private readonly fired = new Set<number>();

  constructor(opts: QuartileTrackerOptions = {}) {
    this.seekThresholdMs = opts.seekThresholdMs ?? 2500;
    this.completeFraction = opts.completeFraction ?? 0.98;
  }

  reset(): void {
    this.last = null;
    this.started = false;
    this.completed = false;
    this.fired.clear();
  }

  update(positionMs: number, durationMs: number | null): TrackerEvent[] {
    const out: TrackerEvent[] = [];
    if (!Number.isFinite(positionMs) || positionMs < 0) return out;
    const pos = Math.round(positionMs);
    if (!this.started) {
      this.started = true;
      out.push({ type: "play", position_ms: pos });
    }
    const prev = this.last;
    this.last = pos;
    if (prev === null) return out;
    const delta = pos - prev;
    const continuous = delta >= 0 && delta <= this.seekThresholdMs;
    if (!continuous) {
      out.push({ type: "seek", position_ms: pos, value: prev });
      return out;
    }
    if (!durationMs || durationMs <= 0) return out;
    for (const q of QUARTILES) {
      const mark = (durationMs * q) / 100;
      if (!this.fired.has(q) && prev < mark && pos >= mark) {
        this.fired.add(q);
        out.push({ type: "quartile", position_ms: pos, value: q });
      }
    }
    if (!this.completed && pos >= durationMs * this.completeFraction) {
      this.completed = true;
      out.push({ type: "complete", position_ms: pos });
    }
    return out;
  }

  ended(positionMs: number): TrackerEvent[] {
    if (this.completed || !this.started) return [];
    this.completed = true;
    return [{ type: "complete", position_ms: Math.max(0, Math.round(positionMs)) }];
  }
}
