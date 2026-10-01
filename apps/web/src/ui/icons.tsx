// Inline SVG icons, copied stroke-for-stroke from the prototype so the consumer surface matches it
// exactly without external assets. Stroke is currentColor so the nav active state can paint rose.
// No em dashes.

import type { SVGProps } from "react";

const stroke = (props: SVGProps<SVGSVGElement>) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  ...props,
});

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...stroke(props)}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...stroke(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </svg>
  );
}

export function WalletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...stroke(props)}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
    </svg>
  );
}

export function YouIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...stroke(props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

export function BackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...stroke(props)}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

// The a11y / "ear" waveform icon from the prototype top bar and right rail.
export function A11yIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...stroke(props)}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  );
}

export function HeartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 21s-7-4.6-9.3-9C1 8.5 3 5 6.5 5 9 5 12 8 12 8s3-3 5.5-3C21 5 23 8.5 21.3 12 19 16.4 12 21 12 21z" />
    </svg>
  );
}

export function CommentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...stroke(props)}>
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...stroke(props)}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function RotateIcon(props: SVGProps<SVGSVGElement>) {
  // A phone with a rotate arrow: vertical to horizontal.
  return (
    <svg {...stroke(props)}>
      <rect x="3" y="4" width="11" height="16" rx="2" />
      <path d="M17 9a5 5 0 0 1 4 5v3" />
      <path d="M21 17l-2-2M21 17l2-2" />
    </svg>
  );
}

export function MapIcon(props: SVGProps<SVGSVGElement>) {
  // A folded map: the Cuts browser affordance (see + switch the cuts available to you).
  return (
    <svg {...stroke(props)}>
      <path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </svg>
  );
}

// Shorts: a vertical frame with a play mark.
export function ShortsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" {...props}>
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
