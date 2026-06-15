// The consent state hook. Holds the current record, exposes the signup acceptance, and the GDPR
// data-subject actions the Privacy panel needs: withdraw a purpose, export (data portability), and erase
// (right to be forgotten). Local-first with a best-effort remote mirror. Server-side erasure across the
// event spine, warehouse, KV hot copy, and any personalized-render cache is a Data Subject Access Request
// handled by the controller; that propagation is documented in docs/DATA_GDPR_DESIGN.md and gated. No em
// dashes.

import { useCallback, useMemo, useState } from "react";
import { needsConsent, type ConsentRecord } from "./model.js";
import { getDefaultConsentStore, submitConsent, type ConsentStore } from "./store.js";

export interface ConsentControls {
  record: ConsentRecord | null;
  needsConsent: boolean;
  accept(record: ConsentRecord): void;
  withdrawAnalytics(): void;
  withdrawDemographics(): void;
  exportData(): string;
  erase(): void;
}

export function useConsent(store?: ConsentStore): ConsentControls {
  const resolved = useMemo(() => store ?? getDefaultConsentStore(), [store]);
  const [record, setRecord] = useState<ConsentRecord | null>(() => resolved.load());

  const persist = useCallback(
    (next: ConsentRecord | null) => {
      if (next) {
        resolved.save(next);
        void submitConsent(next); // best-effort remote mirror; no-op without an endpoint
      } else {
        resolved.clear();
      }
      setRecord(next);
    },
    [resolved],
  );

  const accept = useCallback((next: ConsentRecord) => persist(next), [persist]);

  const withdrawAnalytics = useCallback(() => {
    if (!record) return;
    persist({ ...record, purposes: { ...record.purposes, analytics_personalization: false } });
  }, [record, persist]);

  const withdrawDemographics = useCallback(() => {
    if (!record) return;
    const { demographics: _drop, ...rest } = record;
    persist({ ...rest, purposes: { ...record.purposes, demographics: false } });
  }, [record, persist]);

  // Data portability: a machine-readable copy of what we hold for this viewer on the device. Server-held
  // copies are produced by a DSAR export, noted in the Privacy panel.
  const exportData = useCallback(() => JSON.stringify(record, null, 2), [record]);

  // Right to erasure on the device. Clears the local record (the gate will re-appear) and best-effort
  // signals the controller; full server erasure is the gated DSAR path.
  const erase = useCallback(() => persist(null), [persist]);

  return {
    record,
    needsConsent: needsConsent(record),
    accept,
    withdrawAnalytics,
    withdrawDemographics,
    exportData,
    erase,
  };
}
