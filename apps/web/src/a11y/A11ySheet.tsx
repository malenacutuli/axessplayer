// The accessibility and language sheet, matching the prototype's player a11y sheet exactly: an
// eyebrow ("Accessible by default"), a heading, three toggles (Captions / Audio description / Sign
// language inset), and a language chip row. Toggles persist via the preferences store. A track the
// current cut does not carry is shown disabled with a note, never silently hidden (accessibility
// first). Keyboard reachable; labelled as a dialog. No em dashes.

import type { A11yPreferences, ActiveA11y } from "./preferences.js";

export interface A11ySheetProps {
  prefs: A11yPreferences;
  active: ActiveA11y;
  availableLanguages: string[];
  onChange: (next: A11yPreferences) => void;
  onClose: () => void;
}

const LANG_LABEL: Record<string, string> = {
  en: "English",
  es: "Español",
  ar: "العربية",
  fr: "Français",
};

export function A11ySheet({ prefs, active, availableLanguages, onChange, onClose }: A11ySheetProps) {
  const set = (patch: Partial<A11yPreferences>) => onChange({ ...prefs, ...patch });
  const unavailable = (track: "captions" | "audioDescription" | "sign") =>
    active.unavailable.includes(track);

  // The prototype shows a fixed set of language chips; offer those, marking the active one.
  const langs = availableLanguages.length ? availableLanguages : [active.language];
  const chips = Array.from(new Set([...langs, "en", "es", "ar", "fr"])).slice(0, 4);

  return (
    <div
      className="sheet up"
      role="dialog"
      aria-modal="true"
      aria-label="Accessibility and language"
      data-testid="a11y-sheet"
    >
      <div className="axp-eyebrow">Accessible by default</div>
      <h3>Accessibility &amp; language</h3>

      <div className="opt">
        <span>Captions{unavailable("captions") && <span className="muted"> (not in this cut)</span>}</span>
        <button
          type="button"
          className={prefs.captions ? "toggle" : "toggle off"}
          aria-pressed={prefs.captions}
          aria-label="Captions"
          onClick={() => set({ captions: !prefs.captions })}
          data-testid="a11y-captions"
        >
          <i />
        </button>
      </div>

      <div className="opt">
        <span>
          Audio description
          {unavailable("audioDescription") && <span className="muted"> (not in this cut)</span>}
        </span>
        <button
          type="button"
          className={prefs.audioDescription ? "toggle" : "toggle off"}
          aria-pressed={prefs.audioDescription}
          aria-label="Audio description"
          onClick={() => set({ audioDescription: !prefs.audioDescription })}
          data-testid="a11y-audio-description"
        >
          <i />
        </button>
      </div>

      <div className="opt">
        <span>
          Sign language inset
          {unavailable("sign") && <span className="muted"> (not in this cut)</span>}
        </span>
        <button
          type="button"
          className={prefs.sign ? "toggle" : "toggle off"}
          aria-pressed={prefs.sign}
          aria-label="Sign language inset"
          onClick={() => set({ sign: !prefs.sign })}
          data-testid="a11y-sign"
        >
          <i />
        </button>
      </div>

      <div className="opt" style={{ display: "block", border: 0, paddingTop: 14 }}>
        <span>Language</span>
        <div className="langrow" role="group" aria-label="Language">
          {chips.map((lang) => (
            <button
              type="button"
              key={lang}
              className={active.language === lang ? "chip on" : "chip"}
              aria-pressed={active.language === lang}
              onClick={() => set({ language: lang })}
              data-testid={`a11y-lang-${lang}`}
            >
              {LANG_LABEL[lang] ?? lang}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="paybtn ghost" onClick={onClose} data-testid="a11y-done">
        Done
      </button>
    </div>
  );
}
