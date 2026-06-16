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
  // Real track availability from the served variant (0009a). A track with no URL is shown disabled with a
  // "not available for this title" note, and its toggle does nothing (graceful absence, never an empty box).
  availability?: { captions: boolean; audioDescription: boolean; sign: boolean };
  onChange: (next: A11yPreferences) => void;
  onClose: () => void;
}

const LANG_LABEL: Record<string, string> = {
  en: "English",
  es: "Español",
  ar: "العربية",
  fr: "Français",
};

export function A11ySheet({ prefs, active, availableLanguages, availability, onChange, onClose }: A11ySheetProps) {
  const set = (patch: Partial<A11yPreferences>) => onChange({ ...prefs, ...patch });
  // A track is present when the served variant carries it (0009a). Defaults to true when availability is not
  // provided (standalone rendering).
  const present = (track: "captions" | "audioDescription" | "sign") => availability?.[track] ?? true;

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

      <div className="opt" data-available={present("captions")}>
        <span>Captions{!present("captions") && <span className="muted"> (not available for this title)</span>}</span>
        <button
          type="button"
          className={prefs.captions && present("captions") ? "toggle" : "toggle off"}
          aria-pressed={prefs.captions && present("captions")}
          aria-label="Captions"
          disabled={!present("captions")}
          onClick={() => present("captions") && set({ captions: !prefs.captions })}
          data-testid="a11y-captions"
          style={present("captions") ? undefined : { opacity: 0.4, cursor: "not-allowed" }}
        >
          <i />
        </button>
      </div>

      <div className="opt" data-available={present("audioDescription")}>
        <span>
          Audio description
          {!present("audioDescription") && <span className="muted"> (not available for this title)</span>}
        </span>
        <button
          type="button"
          className={prefs.audioDescription && present("audioDescription") ? "toggle" : "toggle off"}
          aria-pressed={prefs.audioDescription && present("audioDescription")}
          aria-label="Audio description"
          disabled={!present("audioDescription")}
          onClick={() => present("audioDescription") && set({ audioDescription: !prefs.audioDescription })}
          data-testid="a11y-audio-description"
          style={present("audioDescription") ? undefined : { opacity: 0.4, cursor: "not-allowed" }}
        >
          <i />
        </button>
      </div>

      <div className="opt" data-available={present("sign")}>
        <span>
          Sign language inset
          {!present("sign") && <span className="muted"> (not available for this title)</span>}
        </span>
        <button
          type="button"
          className={prefs.sign && present("sign") ? "toggle" : "toggle off"}
          aria-pressed={prefs.sign && present("sign")}
          aria-label="Sign language inset"
          disabled={!present("sign")}
          onClick={() => present("sign") && set({ sign: !prefs.sign })}
          data-testid="a11y-sign"
          style={present("sign") ? undefined : { opacity: 0.4, cursor: "not-allowed" }}
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
