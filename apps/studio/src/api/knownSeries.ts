// The library surfaces. The content service exposes a graph read per series (GET /series/{id}/graph) but
// no "list all series" route, so the Library loads the one REAL seeded series ("The Last Signal") by its
// known seed id and renders the others as styled placeholders (DRAFT / OUTLINE), exactly as the prototype
// does. When a list endpoint lands, replace PLACEHOLDER_SERIES with a real fetch. No em dashes.

// The seeded series id from supabase/seed.sql. This is the only series wired to the live graph.
export const LAST_SIGNAL_SERIES_ID = "11111111-1111-1111-1111-111111111111";

export type PublishState = "live" | "draft" | "outline";

export interface LibraryCard {
  // For the real card this is the live series id; placeholders have no live id.
  seriesId?: string;
  title: string;
  gradientClass: string; // a .gp / .g2 / .g3 / .g4 poster class from the prototype
  publish: PublishState;
  subtitle: string;
}

// Mirrors the prototype's library grid. The first card is live and clickable into the branch editor.
export const LIBRARY_CARDS: LibraryCard[] = [
  {
    seriesId: LAST_SIGNAL_SERIES_ID,
    title: "The Last Signal",
    gradientClass: "gp",
    publish: "live",
    subtitle: "Ep 1 - 5 beats",
  },
  { title: "Five Years to Burn It Down", gradientClass: "g4", publish: "draft", subtitle: "Ep 1" },
  { title: "Rejected by the Alpha", gradientClass: "g3", publish: "draft", subtitle: "Ep 1" },
  { title: "The 90-Day Wife", gradientClass: "g2", publish: "outline", subtitle: "" },
];
