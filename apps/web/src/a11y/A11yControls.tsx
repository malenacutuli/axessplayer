// Accessibility track controls for the player. Captions, audio description, sign, and language are on
// by default; this panel lets the viewer toggle them and pick a language. Toggles persist via the
// preferences store. Tracks the current variant does not carry are shown disabled with an
// explanation, never silently hidden. No em dashes.

import type { A11yPreferences, ActiveA11y } from "./preferences.js";

export interface A11yControlsProps {
  prefs: A11yPreferences;
  active: ActiveA11y;
  // The languages this cut offers, for the language picker.
  availableLanguages: string[];
  onChange: (next: A11yPreferences) => void;
}

export function A11yControls({ prefs, active, availableLanguages, onChange }: A11yControlsProps) {
  const set = (patch: Partial<A11yPreferences>) => onChange({ ...prefs, ...patch });
  const isUnavailable = (track: "captions" | "audioDescription" | "sign") =>
    active.unavailable.includes(track);

  return (
    <section className="a11y-controls" aria-label="Accessibility settings">
      <h3>Accessibility</h3>

      <label>
        <input
          type="checkbox"
          checked={prefs.captions}
          onChange={(e) => set({ captions: e.target.checked })}
          data-testid="a11y-captions"
        />
        Captions
        {isUnavailable("captions") && <span className="a11y-note"> (not in this cut)</span>}
      </label>

      <label>
        <input
          type="checkbox"
          checked={prefs.audioDescription}
          onChange={(e) => set({ audioDescription: e.target.checked })}
          data-testid="a11y-audio-description"
        />
        Audio description
        {isUnavailable("audioDescription") && <span className="a11y-note"> (not in this cut)</span>}
      </label>

      <label>
        <input
          type="checkbox"
          checked={prefs.sign}
          onChange={(e) => set({ sign: e.target.checked })}
          data-testid="a11y-sign"
        />
        Sign language
        {isUnavailable("sign") && <span className="a11y-note"> (not in this cut)</span>}
      </label>

      <label>
        Language
        <select
          value={active.language}
          onChange={(e) => set({ language: e.target.value })}
          data-testid="a11y-language"
        >
          {(availableLanguages.length ? availableLanguages : [active.language]).map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
