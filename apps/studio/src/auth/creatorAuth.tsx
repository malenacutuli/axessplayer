// Creator Studio auth + tiers shell (prompt 22, section 1). A dependency-free auth context that models a
// signed-in creator, their TIER (solo / agency / production), and a Simple-default / Pro mode toggle. This
// is the authoring-side identity shell; it is NOT a request body field (the content client never sends a
// user_id, F1). The shell is deliberately a stub: there is no creator-auth backend yet, so sign-in here is
// a local session that unlocks the studio surfaces. Agency multi-client switching and production multi-seat
// are coming-soon stubs surfaced through the tier, not real features. No em dashes.
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type CreatorTier = "solo" | "agency" | "production";
export type StudioMode = "simple" | "pro";

export interface CreatorTierInfo {
  id: CreatorTier;
  label: string;
  blurb: string;
  // Advanced multi-X capability that is not built yet (a coming-soon stub at this tier).
  comingSoon?: string;
}

export const CREATOR_TIERS: CreatorTierInfo[] = [
  { id: "solo", label: "Solo", blurb: "One creator, one channel. Everything you need to publish." },
  {
    id: "agency",
    label: "Agency",
    blurb: "Manage several creator channels from one workspace.",
    comingSoon: "Multi-client switching",
  },
  {
    id: "production",
    label: "Production",
    blurb: "A full team with seats, roles, and rights management.",
    comingSoon: "Multi-seat teams",
  },
];

export interface CreatorSession {
  name: string;
  tier: CreatorTier;
}

export interface CreatorAuthApi {
  session: CreatorSession | null;
  mode: StudioMode;
  signIn: (session: CreatorSession) => void;
  signOut: () => void;
  setMode: (mode: StudioMode) => void;
  setTier: (tier: CreatorTier) => void;
}

const CreatorAuthContext = createContext<CreatorAuthApi | null>(null);

export interface CreatorAuthProviderProps {
  children: React.ReactNode;
  // Tests inject an already-signed-in creator so they can render a surface without walking the auth shell.
  initialSession?: CreatorSession | null;
  initialMode?: StudioMode;
}

export function CreatorAuthProvider({
  children,
  initialSession = null,
  initialMode = "simple",
}: CreatorAuthProviderProps): JSX.Element {
  const [session, setSession] = useState<CreatorSession | null>(initialSession);
  // Simple is the default. Pro is an explicit opt-in that reveals advanced panels via data-pro-only.
  const [mode, setMode] = useState<StudioMode>(initialMode);

  const signIn = useCallback((next: CreatorSession) => setSession(next), []);
  const signOut = useCallback(() => setSession(null), []);
  const setTier = useCallback(
    (tier: CreatorTier) => setSession((s) => (s ? { ...s, tier } : s)),
    [],
  );

  const api = useMemo<CreatorAuthApi>(
    () => ({ session, mode, signIn, signOut, setMode, setTier }),
    [session, mode, signIn, signOut, setTier],
  );

  return <CreatorAuthContext.Provider value={api}>{children}</CreatorAuthContext.Provider>;
}

export function useCreatorAuth(): CreatorAuthApi {
  const ctx = useContext(CreatorAuthContext);
  if (!ctx) throw new Error("useCreatorAuth must be used within a CreatorAuthProvider");
  return ctx;
}

export function tierInfo(tier: CreatorTier): CreatorTierInfo {
  return CREATOR_TIERS.find((t) => t.id === tier) ?? CREATOR_TIERS[0];
}
