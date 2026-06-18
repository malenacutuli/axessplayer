// The light bottom nav from the prototype: Home / Search / Wallet / You. The active tab paints ink,
// its icon paints rose (the single focal accent on these light screens). Search now routes to the
// 20-V3 search surface (/search) instead of being inert. No em dashes.

import { HomeIcon, SearchIcon, WalletIcon, YouIcon } from "./icons.js";

export type Tab = "home" | "search" | "wallet" | "you";

export interface BottomNavProps {
  active: Tab;
  onNavigate: (tab: Tab) => void;
}

export function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <nav className="nav" aria-label="Primary">
      <button
        type="button"
        className={active === "home" ? "on" : undefined}
        aria-current={active === "home" ? "page" : undefined}
        onClick={() => onNavigate("home")}
      >
        <HomeIcon />
        Home
      </button>
      <button
        type="button"
        className={active === "search" ? "on" : undefined}
        aria-current={active === "search" ? "page" : undefined}
        onClick={() => onNavigate("search")}
      >
        <SearchIcon />
        Search
      </button>
      <button
        type="button"
        className={active === "wallet" ? "on" : undefined}
        aria-current={active === "wallet" ? "page" : undefined}
        onClick={() => onNavigate("wallet")}
      >
        <WalletIcon />
        Wallet
      </button>
      <button
        type="button"
        className={active === "you" ? "on" : undefined}
        aria-current={active === "you" ? "page" : undefined}
        onClick={() => onNavigate("you")}
      >
        <YouIcon />
        You
      </button>
    </nav>
  );
}
