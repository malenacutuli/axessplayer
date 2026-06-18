// Component gallery tree for @axessplayer/ui. One source of truth rendered two ways:
//   - main.tsx hydrates this in the browser (Vercel preview, color-contrast verified there).
//   - axe-audit.ts renders this to static HTML and runs axe-core to gate CI.
// Proves one library themed three ways: every group is shown under viewer, studio, and admin skins.
// WCAG-clean: single h1, sectioned h2 per category, h3 per group, every control labeled. No em dashes.
import * as React from "react";
import {
  SkinScope,
  Logo,
  Wordmark,
  LogoLockup,
  Button,
  IconButton,
  Chip,
  PovPill,
  CutForYouBadge,
  Toggle,
  Card,
  KpiCard,
  StatusChip,
  A11yBadge,
  CreditsPill,
  Scrub,
  Meter,
  LiftBand,
  TabBar,
  Tab,
  RailItem,
  Skeleton,
  EmptyState,
  ErrorState,
} from "@axessplayer/ui";
import type { Skin, BadgeKind, StatusKind } from "@axessplayer/ui";

const SKINS: Skin[] = ["viewer", "studio", "admin"];
const BADGES: BadgeKind[] = ["cc", "ad", "sign", "lang", "c2pa", "ready"];
const STATUSES: StatusKind[] = ["live", "review", "processing", "draft", "failed"];

// Inline stroke icons (no emoji glyphs). aria-hidden via the consuming component.
function IconPlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <path d="M7 5l12 7-12 7z" />
    </svg>
  );
}
function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function IconLibrary() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85">
      <path d="M6 4v16M11 4v16M16 6l4 14" />
    </svg>
  );
}

// A labeled group inside a category. Uses h3 so heading order is h1 -> h2 -> h3.
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ font: "var(--axp-w-medium) 13px var(--axp-font-mono)", letterSpacing: "var(--axp-ls-mono)", textTransform: "uppercase", color: "var(--axp-muted)", margin: "0 0 10px" }}>
        {title}
      </h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>{children}</div>
    </div>
  );
}

// One category, rendered once per skin so the gallery proves the same library themed three ways.
function Category({ id, title, render }: { id: string; title: string; render: (skin: Skin) => React.ReactNode }) {
  return (
    <section aria-labelledby={`cat-${id}`} style={{ margin: "0 0 36px" }}>
      <h2 id={`cat-${id}`} style={{ font: "var(--axp-w-semibold) 16px var(--axp-font-display)", color: "var(--axp-ink)", margin: "0 0 14px", borderBottom: "1px solid var(--axp-hairline)", paddingBottom: 8 }}>
        {title}
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 18 }}>
        {SKINS.map((skin) => (
          <SkinScope
            key={skin}
            skin={skin}
            style={{ background: "var(--axp-surface)", border: "1px solid var(--axp-border)", borderRadius: "var(--axp-radius-card)", padding: 16 }}
          >
            <p style={{ font: "var(--axp-w-medium) 11px var(--axp-font-mono)", letterSpacing: "var(--axp-ls-mono)", textTransform: "uppercase", color: "var(--axp-faint)", margin: "0 0 12px" }}>
              skin: {skin}
            </p>
            {render(skin)}
          </SkinScope>
        ))}
      </div>
    </section>
  );
}

// The full gallery React tree. Pure render, safe for renderToStaticMarkup.
export function Gallery() {
  return (
    <main
      style={{
        background: "var(--axp-bg)",
        color: "var(--axp-ink)",
        fontFamily: "var(--axp-font-body)",
        minHeight: "100vh",
        padding: "32px 28px 64px",
      }}
    >
      <header style={{ marginBottom: 28 }}>
        <LogoLockup size={30} />
        <h1 style={{ font: "var(--axp-w-semibold) 30px var(--axp-font-display)", letterSpacing: "var(--axp-ls-display-sm)", margin: "14px 0 6px" }}>
          Component gallery
        </h1>
        <p style={{ color: "var(--axp-ink-2)", fontSize: 14, margin: 0, maxWidth: 640 }}>
          One shared library, three skins. Every exported component is shown in its states across the viewer, studio, and admin skins. This page gates CI via axe-core.
        </p>
      </header>

      <Category
        id="brand"
        title="Brand"
        render={() => (
          <>
            <Group title="Logo">
              <Logo size={40} />
            </Group>
            <Group title="Wordmark">
              <Wordmark size={24} />
            </Group>
            <Group title="Lockup">
              <LogoLockup size={28} />
            </Group>
          </>
        )}
      />

      <Category
        id="buttons"
        title="Buttons"
        render={() => (
          <>
            <Group title="Variants">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
            </Group>
            <Group title="Sizes and disabled">
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
            </Group>
            <Group title="Icon buttons">
              <IconButton label="Play">
                <IconPlay />
              </IconButton>
              <IconButton size="sm" label="Play small">
                <IconPlay />
              </IconButton>
            </Group>
          </>
        )}
      />

      <Category
        id="pills"
        title="Pills and chips"
        render={() => (
          <>
            <Group title="Chip states">
              <Chip>Default</Chip>
              <Chip active>Active</Chip>
            </Group>
            <Group title="POV pill">
              <PovPill>Director POV</PovPill>
            </Group>
            <Group title="Cut for you">
              <CutForYouBadge />
            </Group>
          </>
        )}
      />

      <Category
        id="toggles"
        title="Toggles"
        render={() => (
          <>
            <Group title="Off">
              <Toggle checked={false} onChange={() => {}} label="Captions off" />
            </Group>
            <Group title="On">
              <Toggle checked onChange={() => {}} label="Captions on" />
            </Group>
          </>
        )}
      />

      <Category
        id="cards"
        title="Cards"
        render={() => (
          <>
            <Group title="Default">
              <Card title="Episode 1" subtitle="The first cut">
                <p style={{ color: "var(--axp-ink-2)", fontSize: 14, margin: 0 }}>A card with title, subtitle, and body content.</p>
              </Card>
            </Group>
          </>
        )}
      />

      <Category
        id="kpis"
        title="KPIs"
        render={() => (
          <>
            <Group title="Tones">
              <KpiCard label="Completion" value="82%" trend="up 4 pts" tone="green" />
              <KpiCard label="Credits earned" value="1,240" tone="gold" />
              <KpiCard label="Sessions" value="318" tone="neutral" />
            </Group>
          </>
        )}
      />

      <Category
        id="status"
        title="Status and badges"
        render={() => (
          <>
            <Group title="Status chips">
              {STATUSES.map((s) => (
                <StatusChip key={s} status={s} />
              ))}
            </Group>
            <Group title="Accessibility badges">
              {BADGES.map((k) => (
                <A11yBadge key={k} kind={k} />
              ))}
            </Group>
          </>
        )}
      />

      <Category
        id="credits"
        title="Credits"
        render={() => (
          <>
            <Group title="Credits pill">
              <CreditsPill amount={1240} />
              <CreditsPill amount="12.5k" />
            </Group>
          </>
        )}
      />

      <Category
        id="progress"
        title="Progress and bands"
        render={() => (
          <>
            <Group title="Scrub">
              <div style={{ width: 220 }}>
                <Scrub value={42} />
              </div>
              <div style={{ width: 220 }}>
                <Scrub value={70} trackDark />
              </div>
            </Group>
            <Group title="Meter">
              <div style={{ width: 220 }}>
                <Meter value={64} label="Caption coverage" />
              </div>
            </Group>
            <Group title="Lift band">
              <div style={{ width: 220 }}>
                <LiftBand low={28} high={54} center={41} label="Estimated ending lift between 28% and 54%" />
              </div>
            </Group>
          </>
        )}
      />

      <Category
        id="navigation"
        title="Navigation"
        render={() => (
          <>
            <Group title="Tab bar (viewer)">
              <TabBar>
                <Tab current label="Home" icon={<IconHome />} />
                <Tab label="Library" icon={<IconLibrary />} />
              </TabBar>
            </Group>
            <Group title="Rail item (console)">
              <RailItem current label="Overview" icon={<IconHome />} />
              <RailItem label="Library" icon={<IconLibrary />} />
            </Group>
          </>
        )}
      />

      <Category
        id="states"
        title="States"
        render={() => (
          <>
            <Group title="Loading (Skeleton)">
              <div style={{ width: 220, display: "grid", gap: 8 }}>
                <Skeleton width="60%" height={18} />
                <Skeleton height={12} />
                <Skeleton width="80%" height={12} />
              </div>
            </Group>
            <Group title="Empty">
              <EmptyState title="Nothing here yet" action={<Button variant="secondary">Add a cut</Button>}>
                <p style={{ color: "var(--axp-muted)", fontSize: 14, margin: "6px 0 0" }}>Published cuts will appear in this list.</p>
              </EmptyState>
            </Group>
            <Group title="Error">
              <ErrorState action={<Button variant="secondary">Retry</Button>}>
                <p style={{ color: "var(--axp-ink-2)", fontSize: 14, margin: "6px 0 0" }}>We could not load this section.</p>
              </ErrorState>
            </Group>
          </>
        )}
      />
    </main>
  );
}
