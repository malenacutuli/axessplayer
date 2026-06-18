// The Creator Studio left rail: the "axess studio" wordmark and the 14 studio sections, plus the creator
// identity, tier, and the Simple-default / Pro toggle. Pro-only sections are present in the DOM with a
// data-pro-only marker and only become visible/reachable when Pro mode is on (the data-pro-only reveal
// pattern). The active section gets .on (white pill, rose icon). Every section is a real, reachable route.
// Built on the @axessplayer/ui STUDIO skin tokens. WCAG AA. No em dashes.
import { Toggle } from "@axessplayer/ui";
import { STUDIO_SECTIONS, SECTION_ICONS, type SectionId } from "../sections.js";
import { tierInfo, useCreatorAuth } from "../auth/creatorAuth.js";
import { sectionHref } from "../router.js";

export interface StudioRailProps {
  active: string;
  onSelect: (id: SectionId) => void;
}

export function StudioRail({ active, onSelect }: StudioRailProps): JSX.Element {
  const { session, mode, setMode, signOut } = useCreatorAuth();
  const isPro = mode === "pro";
  const tier = session ? tierInfo(session.tier) : tierInfo("solo");

  return (
    <div className="srail">
      <div className="lg">
        <span className="mk" aria-hidden />
        axess<span className="pl">studio</span>
      </div>

      <nav className="snav" aria-label="Studio sections">
        {STUDIO_SECTIONS.map((item) => {
          // Pro-only sections stay in the DOM (data-pro-only) but are hidden until Pro is on, so the reveal
          // is a single declarative toggle, not a branch that forgets a route.
          const hidden = item.proOnly && !isPro;
          return (
            <a
              key={item.id}
              href={sectionHref(item.id)}
              className={`snav-link ${active === item.id ? "on" : ""}`}
              aria-current={active === item.id ? "page" : undefined}
              data-testid={`nav-${item.id}`}
              data-pro-only={item.proOnly ? "true" : undefined}
              hidden={hidden || undefined}
              onClick={(e) => {
                // Keep it a real anchor (linkable, middle-click opens) but route in-app on plain click.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                onSelect(item.id);
              }}
            >
              {SECTION_ICONS[item.id]}
              <span className="snav-label">{item.label}</span>
              {!item.built && (
                <span className="snav-soon" data-testid={`soon-${item.id}`}>
                  Soon
                </span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="rail-foot">
        <div className="rail-mode">
          <Toggle checked={isPro} onChange={(v) => setMode(v ? "pro" : "simple")} label="Pro mode" />
          <span className="rail-mode__label" data-testid="mode-label">
            {isPro ? "Pro" : "Simple"}
          </span>
        </div>
        <div className="help">
          Signed in as
          <br />
          <b data-testid="creator-name">{session?.name ?? "Studio"}</b>
          <br />
          <span className="rail-tier" data-testid="creator-tier">
            {tier.label} tier
          </span>
        </div>
        <button type="button" className="rail-signout" data-testid="sign-out" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
