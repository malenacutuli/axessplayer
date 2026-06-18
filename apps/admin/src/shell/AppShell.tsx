// The operator-console app shell: a 60px topbar (logo lockup + operator-console tag, role chip from
// GET /admin/me, an alerts chip) and a 240px left rail with the 16 sections grouped Content / People /
// Business / Trust & system, built on @axessplayer/ui RailItem. The rail items render inside router <Link>
// anchors so every section is a real, linkable, back-button-safe route (no dead end). WCAG 2.2 AA:
// keyboard reachable, visible focus rings, a skip link, the current route marked aria-current. No emojis,
// no em dashes.
import { Logo, RailItem, Wordmark } from "@axessplayer/ui";
import { Link, useRouter } from "../router/router";
import { useRole } from "../access/useRole";
import { NAV } from "./nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { path } = useRouter();
  const { me, role } = useRole();
  const initial = (me.operator.name || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="adm-shell">
      <a href="#adm-main" className="adm-skip-link">
        Skip to main content
      </a>

      {/* topbar */}
      <header className="adm-topbar">
        <div className="adm-topbar__brand">
          <Logo size={26} />
          <Wordmark size={18} />
          <span className="adm-topbar__tag">Operator console</span>
        </div>
        <div className="adm-topbar__right">
          {/* alerts chip: a real link to the system-health route, never a dead control */}
          <Link to="/admin/health" className="adm-chip adm-chip--alert" aria-label="3 alerts, open system health">
            <span className="adm-dot" aria-hidden />
            <span>3 alerts</span>
          </Link>
          {/* role chip from GET /admin/me */}
          <span className="adm-chip" aria-label={`Signed in role: ${role}`}>
            Role: {role}
          </span>
          <span className="adm-avatar" aria-hidden>
            {initial}
          </span>
        </div>
      </header>

      <div className="adm-body">
        {/* left rail */}
        <nav className="adm-rail" aria-label="Operator sections">
          {NAV.map((grp, gi) => (
            <div key={grp.group ?? `top-${gi}`}>
              {grp.group && <div className="adm-rail__section">{grp.group}</div>}
              {grp.items.map((item) => {
                const current = path === item.path || path.startsWith(`${item.path}/`);
                return (
                  <Link
                    key={item.key}
                    to={item.path}
                    aria-current={current ? "page" : undefined}
                    tabIndex={-1}
                  >
                    <RailItem current={current} label={item.label} icon={item.icon} tabIndex={0} />
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* content */}
        <main id="adm-main" className="adm-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
