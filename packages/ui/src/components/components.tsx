// Axessplayer shared component library. One library, three skins (set [data-skin] on a wrapping element).
// Every interactive element is keyboard reachable, has a visible focus ring, and carries the right ARIA.
// Styles live in components.css + tokens.css (imported here so any consumer gets them). No em dashes.
import * as React from "react";
import "../tokens/tokens.css";
import "./components.css";
import type { BadgeKind, StatusKind, Skin } from "../tokens/tokens";

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(" ");

/* ---------------- Skin provider ---------------- */
export function SkinScope({ skin, children, style }: { skin: Skin; children: React.ReactNode; style?: React.CSSProperties }) {
  return <div data-skin={skin} style={style}>{children}</div>;
}

/* ---------------- Logo + wordmark ---------------- */
export function Logo({ size = 28, title = "Axessplayer" }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 360 360" role="img" aria-label={title}>
      <rect x="30" y="30" width="300" height="300" rx="66" fill="#FF2E6E" />
      <path d="M148.8 123.6L236.4 180L148.8 236.4Z" fill="#FFFFFF" />
      <rect x="175.2" y="123.6" width="9" height="112.8" fill="#FF2E6E" />
      <rect x="200.4" y="132.9" width="9" height="94.2" fill="#FF2E6E" />
    </svg>
  );
}
export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <span className="axp-wordmark" style={{ fontSize: size }}>
      axess<span className="axp-wordmark__player">player</span>
    </span>
  );
}
export function LogoLockup({ size = 28 }: { size?: number }) {
  return <span className="axp-logo-lockup"><Logo size={size} /><Wordmark size={size * 0.78} /></span>;
}

/* ---------------- Buttons ---------------- */
type BtnVariant = "primary" | "secondary" | "ghost";
type BtnSize = "md" | "lg";
export function Button({ variant = "primary", size = "md", className, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return <button className={cx("axp-btn", `axp-btn--${variant}`, `axp-btn--${size}`, className)} {...rest} />;
}
export function IconButton({ size = "md", label, children, className, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: "md" | "sm"; label: string }) {
  return (
    <button aria-label={label} className={cx("axp-icon-btn", size === "sm" && "axp-icon-btn--sm", className)} {...rest}>
      {children}
    </button>
  );
}

/* ---------------- Pills / chips ---------------- */
export function Chip({ active, children, className, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button aria-pressed={active} className={cx("axp-chip", active && "axp-chip--active", className)} {...rest}>{children}</button>;
}
export function PovPill({ children }: { children: React.ReactNode }) {
  return <span className="axp-pov-pill">{children}</span>;
}
export function CutForYouBadge({ children = "Cut for you" }: { children?: React.ReactNode }) {
  return <span className="axp-cutforyou"><span className="axp-cutforyou__dot" aria-hidden />{children}</span>;
}

/* ---------------- Toggle (switch) ---------------- */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className="axp-toggle" onClick={() => onChange(!checked)}>
      <span className="axp-toggle__knob" aria-hidden />
    </button>
  );
}

/* ---------------- Cards ---------------- */
export function Card({ title, subtitle, children, className, ...rest }:
  React.HTMLAttributes<HTMLDivElement> & { title?: string; subtitle?: string }) {
  return (
    <section className={cx("axp-card", className)} {...rest}>
      {title && <h3 className="axp-card__title">{title}</h3>}
      {subtitle && <p className="axp-card__subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}
export function KpiCard({ label, value, trend, tone = "neutral" }:
  { label: string; value: React.ReactNode; trend?: string; tone?: "neutral" | "gold" | "green" }) {
  return (
    <div className={cx("axp-kpi", tone === "gold" && "axp-kpi--gold", tone === "green" && "axp-kpi--green")}>
      <div className="axp-kpi__label">{label}</div>
      <div className="axp-kpi__num">{value}</div>
      {trend && <div className="axp-kpi__trend">{trend}</div>}
    </div>
  );
}

/* ---------------- Status chip (tables) ---------------- */
const STATUS_LABEL: Record<StatusKind, string> = { live: "Live", review: "In review", processing: "Processing", draft: "Draft", failed: "Failed" };
export function StatusChip({ status }: { status: StatusKind }) {
  return <span className={`axp-status axp-status--${status}`}>{STATUS_LABEL[status]}</span>;
}

/* ---------------- Accessibility badges ---------------- */
const BADGE_LABEL: Record<BadgeKind, string> = { cc: "CC", ad: "AD", sign: "SIGN", lang: "LANG", c2pa: "C2PA", ready: "Ready" };
const BADGE_A11Y: Record<BadgeKind, string> = {
  cc: "Closed captions available", ad: "Audio description available", sign: "Sign language available",
  lang: "Multiple languages available", c2pa: "Content provenance verified", ready: "Accessibility ready",
};
export function A11yBadge({ kind, text }: { kind: BadgeKind; text?: string }) {
  return <span className={cx("axp-badge", (kind === "c2pa" || kind === "ready") && `axp-badge--${kind}`)} title={BADGE_A11Y[kind]} aria-label={BADGE_A11Y[kind]}>{text ?? BADGE_LABEL[kind]}</span>;
}

/* ---------------- Credits pill ---------------- */
export function CreditsPill({ amount }: { amount: number | string }) {
  return <span className="axp-credits"><span className="axp-credits__dot" aria-hidden>c</span><span>{amount}</span></span>;
}

/* ---------------- Progress / scrub / meter / band ---------------- */
const pct = (v: number) => `${Math.max(0, Math.min(100, v))}%`;
export function Scrub({ value, label = "Playback progress", trackDark }: { value: number; label?: string; trackDark?: boolean }) {
  return (
    <div className={cx("axp-scrub", trackDark && "axp-scrub--track-dark")} role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="axp-scrub__fill" style={{ width: pct(value) }} />
    </div>
  );
}
export function Meter({ value, label = "Coverage" }: { value: number; label?: string }) {
  return (
    <div className="axp-meter" role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className="axp-meter__fill" style={{ width: pct(value) }} />
    </div>
  );
}
// Counterfactual / lift band: ALWAYS a band, never a point. low/high are percent positions of the interval.
export function LiftBand({ low, high, center, label }: { low: number; high: number; center?: number; label?: string }) {
  return (
    <div className="axp-band" role="img" aria-label={label ?? `Estimated lift between ${low}% and ${high}%`}>
      <div className="axp-band__fill" style={{ left: pct(low), width: pct(high - low) }} />
      {center != null && <div className="axp-band__center" style={{ left: pct(center) }} />}
    </div>
  );
}

/* ---------------- Bottom tab bar (viewer) ---------------- */
export function TabBar({ children }: { children: React.ReactNode }) {
  return <nav className="axp-tabbar" aria-label="Primary">{children}</nav>;
}
export function Tab({ current, label, icon, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { current?: boolean; label: string; icon: React.ReactNode }) {
  return (
    <button className="axp-tab" aria-current={current ? "page" : undefined} {...rest}>
      <span aria-hidden>{icon}</span>
      <span className="axp-tab__label">{label}</span>
    </button>
  );
}

/* ---------------- Console rail item ---------------- */
export function RailItem({ current, label, icon, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { current?: boolean; label: string; icon?: React.ReactNode }) {
  return (
    <button className="axp-rail__item" aria-current={current ? "page" : undefined} {...rest}>
      {icon && <span aria-hidden>{icon}</span>}<span>{label}</span>
    </button>
  );
}

/* ---------------- State helpers ---------------- */
export function Skeleton({ width = "100%", height = 16, radius = 8, style }: { width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties }) {
  return <div className="axp-skeleton" aria-hidden style={{ width, height, borderRadius: radius, ...style }} />;
}
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="axp-empty" role="status"><div className="axp-empty__title">{title}</div>{children}{action && <div style={{ marginTop: 14 }}>{action}</div>}</div>;
}
export function ErrorState({ title = "Something went wrong", children, action }: { title?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="axp-error" role="alert"><div className="axp-error__title">{title}</div>{children}{action && <div style={{ marginTop: 14 }}>{action}</div>}</div>;
}
