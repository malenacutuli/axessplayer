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
  // Languages that actually have audio + captions (base language + dubs present). Others render disabled.
  selectableLanguages?: string[];
  // Sign languages produced for this title (ASL, BSL, ...). Empty means no sign track. Shown as a selector
  // under the Sign language toggle when present.
  signLanguages?: string[];
  onChange: (next: A11yPreferences) => void;
  onClose: () => void;
}

const LANG_LABEL: Record<string, string> = {
  en: "English",
  es: "Español",
  ar: "العربية",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  ja: "日本語",
};

export function A11ySheet({ prefs, active, availableLanguages, availability, selectableLanguages, signLanguages, onChange, onClose }: A11ySheetProps) {
  const canSelectLang = (lang: string) => !selectableLanguages || selectableLanguages.includes(lang);
  const set = (patch: Partial<A11yPreferences>) => onChange({ ...prefs, ...patch });
  // A track is present when the served variant carries it (0009a). Defaults to true when availability is not
  // provided (standalone rendering).
  const present = (track: "captions" | "audioDescription" | "sign") => availability?.[track] ?? true;

  // Show every language that actually has audio + captions (base + dubs), so all available languages appear.
  const chips = Array.from(
    new Set([...(selectableLanguages ?? []), ...availableLanguages, active.language].filter(Boolean)),
  );

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
          aria-label="Sign language"
          disabled={!present("sign")}
          onClick={() => present("sign") && set({ sign: !prefs.sign })}
          data-testid="a11y-sign"
          style={present("sign") ? undefined : { opacity: 0.4, cursor: "not-allowed" }}
        >
          <i />
        </button>
      </div>

      {/* Sign-language selection panel: pick which sign language to show (ASL now, more as we produce them). */}
      {present("sign") && (signLanguages?.length ?? 0) > 0 && (
        <div className="langrow" role="group" aria-label="Sign language" data-testid="sign-language-panel" style={{ marginTop: 4, marginBottom: 8 }}>
          {(signLanguages ?? []).map((sl, i) => (
            <button
              type="button"
              key={sl}
              className={i === 0 ? "chip on" : "chip"}
              aria-pressed={i === 0}
              data-testid={`a11y-sign-lang-${sl}`}
            >
              {sl}
            </button>
          ))}
        </div>
      )}

      <div className="opt" style={{ display: "block", border: 0, paddingTop: 14 }}>
        <span>Language</span>
        <div className="langrow" role="group" aria-label="Language">
          {chips.map((lang) => {
            const selectable = canSelectLang(lang);
            return (
              <button
                type="button"
                key={lang}
                className={active.language === lang ? "chip on" : "chip"}
                aria-pressed={active.language === lang}
                disabled={!selectable}
                onClick={() => selectable && set({ language: lang })}
                data-testid={`a11y-lang-${lang}`}
                title={selectable ? undefined : "Not available for this title"}
                style={selectable ? undefined : { opacity: 0.4, cursor: "not-allowed" }}
              >
                {LANG_LABEL[lang] ?? lang}
              </button>
            );
          })}
        </div>
      </div>

      <button type="button" className="paybtn ghost" onClick={onClose} data-testid="a11y-done">
        Done
      </button>
    </div>
  );
}
