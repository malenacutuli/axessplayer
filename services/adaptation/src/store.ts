// The adaptation store port. The DAG core (dag.ts) is pure; this port persists jobs, sources, rights
// gates, and registered variants. The default is an in-memory UNWIRED store: scripts/sql/11_adaptation.sql
// is queued, NOT applied, so nothing lands in mobile.* until a human applies it and a PgAdaptationStore is
// injected here. Every payload carries source:"unwired" so a caller never mistakes an in-process preview
// for a committed, persisted adaptation. No em dashes.

import type { JobRecord } from "./dag.js";
import type { RightsChecklist } from "./rightsGate.js";

export interface SourceRecord {
  sourceId: string;
  assetUrl: string;
  isHero: boolean;
  durationMs: number;
  rights: RightsChecklist;
}

export interface AdaptationStore {
  readonly wired: boolean;
  putSource(s: SourceRecord): Promise<void>;
  getSource(sourceId: string): Promise<SourceRecord | null>;
  putJob(j: JobRecord): Promise<void>;
  getJob(jobId: string): Promise<JobRecord | null>;
  // Set the approved-review flag for a job (POST /jobs/:id/approve), recording the reviewer.
  approveJob(jobId: string, reviewer: string): Promise<JobRecord | null>;
  // Purge variants for a source whose consent was revoked. Returns the purged variant ids.
  purgeForSource(sourceId: string, variantIds: string[]): Promise<string[]>;
}

// A closed, all-false rights checklist: a brand-new source is RED until a human fills the gate.
export function emptyRights(): RightsChecklist {
  return {
    ownsFootage: false,
    actorAdaptationRights: false,
    voiceRights: false,
    likenessRights: false,
    musicRights: false,
    territoryCleared: false,
    brandLogoCleared: false,
    aiTransformationAllowed: false,
    ageSensitiveReviewed: false,
    consentRef: null,
    consentCurrent: false,
  };
}

export class InMemoryStore implements AdaptationStore {
  readonly wired = false;
  private readonly sources = new Map<string, SourceRecord>();
  private readonly jobs = new Map<string, JobRecord>();
  private readonly purged = new Set<string>();

  async putSource(s: SourceRecord): Promise<void> {
    this.sources.set(s.sourceId, s);
  }
  async getSource(sourceId: string): Promise<SourceRecord | null> {
    return this.sources.get(sourceId) ?? null;
  }
  async putJob(j: JobRecord): Promise<void> {
    this.jobs.set(j.jobId, j);
  }
  async getJob(jobId: string): Promise<JobRecord | null> {
    return this.jobs.get(jobId) ?? null;
  }
  async approveJob(jobId: string, reviewer: string): Promise<JobRecord | null> {
    const j = this.jobs.get(jobId);
    if (j == null) return null;
    const next = { ...j, humanReviewApproved: true, reviewer } as JobRecord & { reviewer: string };
    this.jobs.set(jobId, next);
    return next;
  }
  async purgeForSource(_sourceId: string, variantIds: string[]): Promise<string[]> {
    for (const id of variantIds) this.purged.add(id);
    return variantIds;
  }
}
