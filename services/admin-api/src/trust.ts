// Trust read model for GET /admin/trust/consent and GET /admin/trust/provenance. Two blocks plus a GDPR
// queue read:
//   1. CONSENT. A MINIMIZED consent-ledger view. Consent + biometric data lives on the SOVEREIGN plane and
//      is NEVER returned in full to the console. The view exposes ONLY scope/expiry/revocation status, never
//      raw biometric data or PII. There is no consent table in the hosted schema, so this probes for one and
//      returns an empty + source:"unwired" view when absent (never fabricated consent rows). The read is
//      access-logged by the HTTP layer.
//   2. PROVENANCE. C2PA / content-credentials signing status per asset, read from the additive substrate
//      columns on beat_variants (c2pa_signed, c2pa_manifest_url, provenance_id, article50_ai_label). Probes
//      for the columns first (the substrate script may not be applied yet) and reads them defensively.
//   3. GDPR queue. Pending data-subject requests. No request table exists yet, so this is empty + unwired.
// Consent hard-delete + GDPR delete are 501 audit seams in http/app.ts (Admin/Owner only). No em dashes.

import type { QueryPort } from "./aggregate.js";
import {
  consentTableProbeSql,
  provenanceColumnsProbeSql,
  provenanceRollupSql,
  provenanceStatusSql,
  type Sql,
} from "./queries.js";

async function run<T = Record<string, unknown>>(db: QueryPort, sql: Sql): Promise<T[]> {
  const r = await db.query(sql.text, sql.values as unknown[]);
  return r.rows as T[];
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const bool = (v: unknown): boolean => v === true || v === "t" || v === "true";

// ---- Consent (MINIMIZED; sovereign-plane safe) ------------------------------------------------------

// One minimized consent-ledger entry. Scope/expiry/revocation ONLY. No raw biometric template, no PII, no
// signature payload. This is the only consent shape that may cross to the console.
export interface ConsentEntry {
  scope: string;
  status: "granted" | "revoked" | "expired";
  expiresAt: string | null;
}

export interface ConsentView {
  entries: ConsentEntry[];
  source: "unwired" | "hosted";
  note: string;
  // Reaffirms the minimization contract in the payload so a console author cannot mistake this for a full
  // consent record.
  minimized: true;
}

const CONSENT_UNWIRED_NOTE =
  "no consent-ledger table in the hosted schema; consent data lives on the sovereign plane and is never returned in full. The minimized view is empty and unwired until a consent source is wired (consent rows are never fabricated)";

// Build the minimized consent view. Probes for a consent table; absent -> empty + unwired. When present,
// the minimized read is pending the sovereign-plane source slice (returned as derived-source empty so a
// real read is a data swap). Even when wired, only scope/expiry/status ever leave the sovereign plane.
export async function buildConsentView(db: QueryPort): Promise<ConsentView> {
  const probe = await run<{ table_name: string }>(db, consentTableProbeSql());
  if (probe.length === 0) {
    return { entries: [], source: "unwired", note: CONSENT_UNWIRED_NOTE, minimized: true };
  }
  return {
    entries: [],
    source: "hosted",
    note: "consent table detected; the minimized scope/expiry/status read is pending the sovereign-plane source slice. Raw biometric/PII is never returned",
    minimized: true,
  };
}

// ---- Provenance (C2PA signing status per asset) -----------------------------------------------------

export interface ProvenanceAsset {
  variantId: string;
  c2paSigned: boolean;
  hasManifest: boolean;
  hasProvenance: boolean;
  aiLabel: string | null;
}

export interface ProvenanceView {
  rollup: { total: number; signed: number; withManifest: number; withProvenance: number };
  // A bounded sample of assets (not the full catalog) so the console renders the surface.
  sample: ProvenanceAsset[];
  source: "unwired" | "hosted";
  note: string;
}

const PROVENANCE_UNWIRED_NOTE =
  "the c2pa/provenance substrate columns are not present on beat_variants (variant_substrate_additive.sql is not applied); provenance status is empty and unwired (never fabricated)";

interface ProvenanceRow {
  variant_id: string;
  c2pa_signed: unknown;
  has_manifest: unknown;
  has_provenance: unknown;
  article50_ai_label: string | null;
}

interface RollupRow {
  total: number;
  signed: number;
  with_manifest: number;
  with_provenance: number;
}

// Build the provenance view. Probes for the c2pa/provenance columns; absent -> empty + unwired (the
// substrate is not applied). When present, reads the rollup + a bounded sample defensively. The columns are
// read through COALESCE in the SQL so a declared-but-null column still returns rows.
export async function buildProvenanceView(db: QueryPort): Promise<ProvenanceView> {
  const cols = await run<{ column_name: string }>(db, provenanceColumnsProbeSql());
  // Require at least the c2pa_signed column to be present before reading; otherwise the substrate is unwired.
  const hasC2pa = cols.some((c) => c.column_name === "c2pa_signed");
  if (!hasC2pa) {
    return {
      rollup: { total: 0, signed: 0, withManifest: 0, withProvenance: 0 },
      sample: [],
      source: "unwired",
      note: PROVENANCE_UNWIRED_NOTE,
    };
  }
  const [rollupRows, sampleRows] = await Promise.all([
    run<RollupRow>(db, provenanceRollupSql()),
    run<ProvenanceRow>(db, provenanceStatusSql()),
  ]);
  const r = rollupRows[0] ?? { total: 0, signed: 0, with_manifest: 0, with_provenance: 0 };
  return {
    rollup: {
      total: num(r.total),
      signed: num(r.signed),
      withManifest: num(r.with_manifest),
      withProvenance: num(r.with_provenance),
    },
    sample: sampleRows.map((s) => ({
      variantId: String(s.variant_id),
      c2paSigned: bool(s.c2pa_signed),
      hasManifest: bool(s.has_manifest),
      hasProvenance: bool(s.has_provenance),
      aiLabel: s.article50_ai_label ?? null,
    })),
    source: "hosted",
    note: "C2PA signing status read from the beat_variants provenance substrate columns",
  };
}

// ---- GDPR queue (pending data-subject requests) -----------------------------------------------------

export interface GdprQueueView {
  requests: Array<{ id: string; kind: "export" | "delete"; subjectRef: string; requestedAt: string; status: string }>;
  source: "unwired" | "hosted";
  note: string;
}

const GDPR_UNWIRED_NOTE =
  "no data-subject-request table in the hosted schema; the GDPR queue is empty and unwired. Export/delete execution is a 501 audit seam (Admin/Owner only)";

// Build the GDPR queue. No request table exists; do NOT fabricate requests. Empty + unwired is the honest
// answer. _db is accepted so the signature is stable once a request source is wired.
export async function buildGdprQueue(_db: QueryPort): Promise<GdprQueueView> {
  void _db;
  return { requests: [], source: "unwired", note: GDPR_UNWIRED_NOTE };
}

// ---- Trust view (composes consent + provenance + gdpr for a single read) ----------------------------

export interface TrustView {
  consent: ConsentView;
  provenance: ProvenanceView;
  gdpr: GdprQueueView;
}

export async function buildTrust(db: QueryPort): Promise<TrustView> {
  const [consent, provenance, gdpr] = await Promise.all([
    buildConsentView(db),
    buildProvenanceView(db),
    buildGdprQueue(db),
  ]);
  return { consent, provenance, gdpr };
}
