// Viewership milestones for one playback: view_3s, then completion 25/50/75/100, each emitted at most once.
// Pure, so it is unit tested and shared by the shorts feed and the watch page. No em dashes.
export type Milestone = "view_3s" | "completion_25" | "completion_50" | "completion_75" | "completion_100";

export function createQuartileTracker(onMilestone: (m: Milestone) => void) {
  const fired = new Set<Milestone>();
  const fire = (m: Milestone) => {
    if (fired.has(m)) return;
    fired.add(m);
    onMilestone(m);
  };
  return {
    update(currentSec: number, durationSec: number): void {
      if (currentSec >= 3) fire("view_3s");
      if (!(durationSec > 0)) return;
      const p = currentSec / durationSec;
      if (p >= 0.25) fire("completion_25");
      if (p >= 0.5) fire("completion_50");
      if (p >= 0.75) fire("completion_75");
      if (p >= 0.98) fire("completion_100");
    },
    ended(): void {
      fire("completion_100");
    },
    fired: () => [...fired],
  };
}
