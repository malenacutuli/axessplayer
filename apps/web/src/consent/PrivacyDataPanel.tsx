// Privacy and data controls in the Profile screen. Surfaces the current consent and the GDPR data-subject
// rights: withdraw a purpose, export a copy (portability), and erase (right to be forgotten). On-device
// actions take effect immediately; full server-side erasure and export across the event spine, warehouse,
// KV, and any personalized-render cache is a Data Subject Access Request handled by the controller, which
// is stated plainly so the control is honest. No em dashes.

import { useState } from "react";
import type { ConsentControls } from "./useConsent.js";
import { POLICY_VERSION } from "./model.js";

export function PrivacyDataPanel({ consent }: { consent: ConsentControls }): JSX.Element {
  const { record } = consent;
  const [note, setNote] = useState<string | null>(null);

  const onExport = () => {
    const json = consent.exportData();
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "axessplayer-my-data.json";
      a.click();
      URL.revokeObjectURL(url);
      setNote("Your on-device data was exported. Server-held data is provided via a data request.");
    } catch {
      setNote("Export is unavailable in this environment.");
    }
  };

  return (
    <div className="privacy-panel" data-testid="privacy-panel">
      <div className="scaption">Privacy and data</div>

      <div className="privacy-state">
        {record ? (
          <>
            <div>
              Policy version <b>{record.policyVersion}</b>
              {record.policyVersion !== POLICY_VERSION ? " (update pending)" : ""}
            </div>
            <div className="muted">
              Personalization and analytics:{" "}
              <b>{record.purposes.analytics_personalization ? "on" : "off"}</b> · Demographics:{" "}
              <b>{record.purposes.demographics ? "on" : "off"}</b>
            </div>
          </>
        ) : (
          <div className="muted">No consent on file.</div>
        )}
      </div>

      <button
        type="button"
        className="btn privacy-action"
        data-testid="withdraw-analytics"
        disabled={!record?.purposes.analytics_personalization}
        onClick={() => {
          consent.withdrawAnalytics();
          setNote("Personalization and analytics consent withdrawn.");
        }}
      >
        Withdraw personalization and analytics
      </button>

      <button
        type="button"
        className="btn privacy-action"
        data-testid="withdraw-demographics"
        disabled={!record?.purposes.demographics}
        onClick={() => {
          consent.withdrawDemographics();
          setNote("Demographics withdrawn and removed from this device.");
        }}
      >
        Withdraw demographics
      </button>

      <button
        type="button"
        className="btn privacy-action"
        data-testid="export-data"
        onClick={onExport}
      >
        Download my data
      </button>

      <button
        type="button"
        className="btn privacy-action danger"
        data-testid="erase-data"
        onClick={() => {
          consent.erase();
          setNote("Consent erased on this device. You will be asked again next time.");
        }}
      >
        Delete my data and withdraw consent
      </button>

      {note ? (
        <p className="muted privacy-note" role="status" data-testid="privacy-note">
          {note}
        </p>
      ) : null}
      <p className="muted privacy-fine">
        Erasure and export here act on this device immediately. Server-held copies are processed as a data
        request by the controller, including the analytics warehouse and any personalized-render cache.
      </p>
    </div>
  );
}
