// The signup consent gate. Shown before the app when there is no acceptance for the current policy
// version. Accepting the Terms and Privacy Policy is required to use the service. Analytics and
// anonymized demographics are SEPARATE optional opt-ins (GDPR unbundling), default off. Demographics are
// coarse cohort categories only. The viewer is told the experience adapts per viewer (EU AI Act
// disclosure). No user id is ever sent in a body; this only builds a local consent record. No em dashes.

import { useState } from "react";
import {
  AGE_BANDS,
  COUNTRIES,
  GENDER_OPTIONS,
  LEGAL,
  MARKET_REGIONS,
  newConsentId,
  POLICY_VERSION,
  type AgeBandValue,
  type ConsentRecord,
  type Demographics,
  type GenderValue,
  type MarketRegionValue,
} from "./model.js";

export interface ConsentGateProps {
  onAccept: (record: ConsentRecord) => void;
}

export function ConsentGate({ onAccept }: ConsentGateProps): JSX.Element {
  const [acceptedRequired, setAcceptedRequired] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [demographics, setDemographics] = useState(false);
  const [gender, setGender] = useState<GenderValue>("prefer_not_to_say");
  const [ageBand, setAgeBand] = useState<AgeBandValue>("prefer_not_to_say");
  const [country, setCountry] = useState<string>("");
  const [region, setRegion] = useState<MarketRegionValue>("prefer_not_to_say");

  const submit = () => {
    if (!acceptedRequired) return;
    const demo: Demographics | undefined = demographics
      ? {
          gender,
          ageBand,
          country: country || undefined,
          marketRegion: region,
        }
      : undefined;
    const record: ConsentRecord = {
      consentId: newConsentId(),
      policyVersion: POLICY_VERSION,
      acceptedTerms: true,
      acceptedPrivacy: true,
      purposes: { analytics_personalization: analytics, demographics },
      demographics: demo,
      recordedAt: new Date().toISOString(),
      locale: typeof navigator !== "undefined" ? navigator.language : undefined,
    };
    onAccept(record);
  };

  return (
    <div className="app-stage">
      <div className="phone">
        <div className="notch" />
        <div className="scr consent-scr" data-testid="consent-gate">
          <div className="consent-pad">
            <div className="consent-brand">
              axess<span className="pl">player</span>
            </div>
            <h2 className="consent-h">Before you start</h2>
            <p className="muted consent-lead">
              Axessplayer re-cuts each story to you and keeps accessibility built in. A few choices about
              your data first. You are in control and can change these any time in Profile.
            </p>

            <label className="consent-required" htmlFor="accept-terms">
              <input
                id="accept-terms"
                type="checkbox"
                data-testid="accept-terms"
                checked={acceptedRequired}
                onChange={(e) => setAcceptedRequired(e.target.checked)}
              />
              <span>
                I have read and accept the{" "}
                <a href={LEGAL.termsUrl} target="_blank" rel="noreferrer" data-testid="legal-terms">
                  Terms and Conditions
                </a>{" "}
                and{" "}
                <a href={LEGAL.privacyUrl} target="_blank" rel="noreferrer" data-testid="legal-privacy">
                  Privacy Policy
                </a>
                .
              </span>
            </label>

            <div className="consent-optionals">
              <div className="ey">Optional, and unbundled</div>

              <PurposeRow
                testid="purpose-analytics"
                label="Personalized adaptive experience and analytics"
                detail="Lets us re-cut the story to you and measure engagement to improve it. Decline and you still get the standard cut."
                on={analytics}
                onToggle={() => setAnalytics((v) => !v)}
              />

              <PurposeRow
                testid="purpose-demographics"
                label="Share anonymized demographics"
                detail="A coarse gender, age band, and region. Stored anonymized and used only to improve recommendations for groups, never to identify you."
                on={demographics}
                onToggle={() => setDemographics((v) => !v)}
              />

              {demographics ? (
                <div className="demo-grid" data-testid="demographics-form">
                  <Field label="Gender" id="demo-gender">
                    <select
                      id="demo-gender"
                      value={gender}
                      onChange={(e) => setGender(e.target.value as GenderValue)}
                    >
                      {GENDER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Age band" id="demo-age">
                    <select
                      id="demo-age"
                      value={ageBand}
                      onChange={(e) => setAgeBand(e.target.value as AgeBandValue)}
                    >
                      {AGE_BANDS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Country" id="demo-country">
                    <select id="demo-country" value={country} onChange={(e) => setCountry(e.target.value)}>
                      <option value="">Prefer not to say</option>
                      {COUNTRIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Region" id="demo-region">
                    <select
                      id="demo-region"
                      value={region}
                      onChange={(e) => setRegion(e.target.value as MarketRegionValue)}
                    >
                      {MARKET_REGIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : null}
            </div>

            <p className="consent-disclose muted">
              Axessplayer adapts the cut you see using an inspectable, named-feature model, and runs a small
              control group. You can object to automated personalization at any time in Profile.
            </p>

            <button
              type="button"
              className="btn pri consent-continue"
              data-testid="consent-continue"
              disabled={!acceptedRequired}
              onClick={submit}
            >
              Accept and continue
            </button>
            <p className="consent-ver muted">Policy version {POLICY_VERSION}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PurposeRow({
  testid,
  label,
  detail,
  on,
  onToggle,
}: {
  testid: string;
  label: string;
  detail: string;
  on: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div className="consent-purpose">
      <div className="consent-purpose-text">
        <div className="consent-purpose-label">{label}</div>
        <div className="muted consent-purpose-detail">{detail}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        data-testid={testid}
        className={`toggle${on ? "" : " off"}`}
        onClick={onToggle}
      >
        <i />
      </button>
    </div>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="demo-fld">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
