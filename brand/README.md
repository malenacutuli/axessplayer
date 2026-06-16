# Axessplayer Brand System

This folder is the single source of truth for the Axessplayer visual identity. Surfaces consume the machine-readable tokens in `packages/ui/src/tokens.ts` and `tokens.css`. Do not hand-edit hex values in surface code. No em dashes. No emoji in product UI.

## Color

Ink #111114 carries the system. Electric Rose #FF2E6E is the single focal accent, used once per layout. Gold #E8B54B is reserved for premium and credits moments, used sparingly. Neutrals are Paper #FAFAF8, Bone #F4F2EC, Line #ECECEC, and Muted #6B6B72.

## Typography

Outfit is used for display and headlines, always lowercase, SemiBold or Bold. Inter is used for body text, UI, and data. JetBrains Mono is used for mono labels, codes, and data tags, uppercase and tracked out. Roboto Flex is the variable-typography engine used only inside the Captions With Intention layer.

## Logo

The primary lockup is the mark plus the wordmark, vertically centered, with fixed clear space. In the wordmark, `axess` is set in ink and `player` in rose, always lowercase. The mark geometry, including the E form, must never be altered. Use the mono and on-black variants on low-contrast or dark surfaces. Vector sources for icon, wordmark, lockup, app icon, avatar, watermark, and merch are in `logo/`.

## Captions With Intention

Color is an opt-in layer and never the only carrier of meaning. A standards-compliant baseline caption path and a non-color fallback (name tag and position) are always present. Volume maps to type size as a percentage of screen height so it is resolution independent, with normal speech at 5 percent. The full character palette and the six-color main-character subset are defined in `packages/ui/src/tokens.ts` under `cwiPalette`.

## Reference

`reference/Axessplayer_Brand_Guidelines.pdf` is the authored guideline document. The Captions With Intention Design System V1.02 governs the caption rendering rules in detail.
