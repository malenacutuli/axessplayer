// Tests for the consent gate, the consent persistence/versioning, and the Privacy panel rights. The gate
// must require the Terms and Privacy acceptance and keep analytics + demographics as separate opt-ins
// (GDPR unbundling). No em dashes.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsentGate } from "./ConsentGate.js";
import { PrivacyDataPanel } from "./PrivacyDataPanel.js";
import {
  LEGAL,
  POLICY_VERSION,
  needsConsent,
  type ConsentRecord,
} from "./model.js";
import { createLocalConsentStore } from "./store.js";
import type { ConsentControls } from "./useConsent.js";

function validRecord(over: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    consentId: "c-1",
    policyVersion: POLICY_VERSION,
    acceptedTerms: true,
    acceptedPrivacy: true,
    purposes: { analytics_personalization: false, demographics: false },
    recordedAt: "2026-06-15T00:00:00.000Z",
    ...over,
  };
}

describe("ConsentGate", () => {
  it("blocks continue until the Terms and Privacy are accepted, then records consent", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<ConsentGate onAccept={onAccept} />);

    const cont = screen.getByTestId("consent-continue");
    expect(cont).toBeDisabled();

    await user.click(screen.getByTestId("accept-terms"));
    expect(cont).toBeEnabled();

    await user.click(cont);
    expect(onAccept).toHaveBeenCalledTimes(1);
    const rec = onAccept.mock.calls[0][0] as ConsentRecord;
    expect(rec.policyVersion).toBe(POLICY_VERSION);
    expect(rec.acceptedTerms).toBe(true);
    expect(rec.acceptedPrivacy).toBe(true);
    // Optional purposes default OFF (opt-in, unbundled), and no demographics captured.
    expect(rec.purposes).toEqual({ analytics_personalization: false, demographics: false });
    expect(rec.demographics).toBeUndefined();
  });

  it("links to the Terms and Privacy Policy documents", () => {
    render(<ConsentGate onAccept={() => {}} />);
    expect(screen.getByTestId("legal-terms")).toHaveAttribute("href", LEGAL.termsUrl);
    expect(screen.getByTestId("legal-privacy")).toHaveAttribute("href", LEGAL.privacyUrl);
  });

  it("reveals the demographics form only on opt-in and records coarse anonymized values", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<ConsentGate onAccept={onAccept} />);

    expect(screen.queryByTestId("demographics-form")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("purpose-demographics"));
    expect(screen.getByTestId("demographics-form")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Gender"), "female");
    await user.selectOptions(screen.getByLabelText("Age band"), "25_34");

    await user.click(screen.getByTestId("accept-terms"));
    await user.click(screen.getByTestId("consent-continue"));

    const rec = onAccept.mock.calls[0][0] as ConsentRecord;
    expect(rec.purposes.demographics).toBe(true);
    expect(rec.demographics).toMatchObject({ gender: "female", ageBand: "25_34" });
    // Anonymized by construction: a band, never a date of birth, and no precise location field exists.
    expect(rec.demographics).not.toHaveProperty("dob");
    expect(rec.demographics).not.toHaveProperty("birthdate");
  });

  it("records analytics consent when the analytics switch is on", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<ConsentGate onAccept={onAccept} />);
    await user.click(screen.getByTestId("purpose-analytics"));
    await user.click(screen.getByTestId("accept-terms"));
    await user.click(screen.getByTestId("consent-continue"));
    const rec = onAccept.mock.calls[0][0] as ConsentRecord;
    expect(rec.purposes.analytics_personalization).toBe(true);
  });
});

describe("consent persistence and versioning", () => {
  it("needsConsent is true when missing, false when current, true when the policy version moved", () => {
    expect(needsConsent(null)).toBe(true);
    expect(needsConsent(validRecord())).toBe(false);
    expect(needsConsent(validRecord({ policyVersion: "0000-00-00.0" }))).toBe(true);
    expect(needsConsent(validRecord({ acceptedTerms: false }))).toBe(true);
  });

  it("the local store round-trips a record and clears it", () => {
    const mem = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    } as unknown as Storage;
    const store = createLocalConsentStore(fakeStorage);
    expect(store.load()).toBeNull();
    const rec = validRecord();
    store.save(rec);
    expect(store.load()).toEqual(rec);
    store.clear();
    expect(store.load()).toBeNull();
  });
});

describe("PrivacyDataPanel", () => {
  function controls(over: Partial<ConsentControls> = {}): ConsentControls {
    return {
      record: validRecord({ purposes: { analytics_personalization: true, demographics: true } }),
      needsConsent: false,
      accept: vi.fn(),
      withdrawAnalytics: vi.fn(),
      withdrawDemographics: vi.fn(),
      exportData: vi.fn(() => "{}"),
      erase: vi.fn(),
      ...over,
    };
  }

  it("withdraws analytics consent on click (right to withdraw)", async () => {
    const user = userEvent.setup();
    const c = controls();
    render(<PrivacyDataPanel consent={c} />);
    await user.click(screen.getByTestId("withdraw-analytics"));
    expect(c.withdrawAnalytics).toHaveBeenCalledTimes(1);
  });

  it("erases on click (right to be forgotten)", async () => {
    const user = userEvent.setup();
    const c = controls();
    render(<PrivacyDataPanel consent={c} />);
    await user.click(screen.getByTestId("erase-data"));
    expect(c.erase).toHaveBeenCalledTimes(1);
  });

  it("disables withdraw buttons when the purpose is already off", () => {
    const c = controls({
      record: validRecord({ purposes: { analytics_personalization: false, demographics: false } }),
    });
    render(<PrivacyDataPanel consent={c} />);
    expect(screen.getByTestId("withdraw-analytics")).toBeDisabled();
    expect(screen.getByTestId("withdraw-demographics")).toBeDisabled();
  });
});
