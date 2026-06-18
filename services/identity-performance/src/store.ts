// Identity store for the identity-performance service. The narrow IdentityStore port is what the routes
// depend on; an in-memory implementation backs the tests and local wiring, and a Postgres-backed impl wires
// to mobile.character_identities (scripts/sql/12, QUEUED FOR APPLY) on the sovereign plane.
//
// SOVEREIGNTY BOUNDARY: an identity record carries reference embeddings/images (biometric reference) that
// live ONLY on the sovereign plane. The store also tracks DERIVED SHOTS (generated/adapted/lipsync/deage
// outputs conditioned on the identity) so the purge path can hard-delete the identity AND everything derived
// from it on revocation. No em dashes.

import { randomUUID } from "node:crypto";

// A reference image / embedding pair the identity lock conditions generation on. On the non-sovereign plane
// these are absent (the row stores metadata only); presence of any reference here marks a REAL-LIKENESS
// identity, which the consent + founder gates govern.
export interface IdentityReferences {
  embeddings: number[][];
  imageUrls: string[];
  voiceRef: string | null;
}

export interface CharacterIdentity {
  id: string;
  seriesId: string;
  characterName: string;
  references: IdentityReferences;
  consentRef: string | null;
  // True when the record carries biometric references (real-likeness). A purely descriptive/stylized
  // identity with no references is NOT real-likeness and is not consent-gated for likeness.
  realLikeness: boolean;
  createdAt: string;
}

// A shot derived from an identity: a generated or adapted output conditioned on the lock. Stored so the purge
// path can hard-delete derived assets when consent is revoked. assetUrl is the produced asset reference (only
// ever set by a wired adapter; never fabricated).
export interface DerivedShot {
  id: string;
  identityId: string;
  kind: "generation" | "lipsync" | "deage";
  // Embedding sampled from the produced shot, used by the drift scorer. Null when no real asset was produced.
  embedding: number[] | null;
  assetUrl: string | null;
  createdAt: string;
}

export interface RegisterIdentityInput {
  seriesId: string;
  characterName: string;
  references: IdentityReferences;
  consentRef: string | null;
  realLikeness: boolean;
}

// Result of a purge: how much was hard-deleted, for the revocation receipt + the audit trail.
export interface PurgeResult {
  identityDeleted: boolean;
  derivedShotsDeleted: number;
}

export interface IdentityStore {
  register(input: RegisterIdentityInput): Promise<CharacterIdentity>;
  get(id: string): Promise<CharacterIdentity | null>;
  listDerivedShots(identityId: string): Promise<DerivedShot[]>;
  recordDerivedShot(shot: Omit<DerivedShot, "id" | "createdAt">): Promise<DerivedShot>;
  // HARD-DELETE the identity and every shot derived from it. Idempotent: purging an absent id is a no-op that
  // reports identityDeleted=false.
  purge(id: string): Promise<PurgeResult>;
}

export class InMemoryIdentityStore implements IdentityStore {
  private readonly identities = new Map<string, CharacterIdentity>();
  private readonly shots = new Map<string, DerivedShot[]>();

  async register(input: RegisterIdentityInput): Promise<CharacterIdentity> {
    const id = randomUUID();
    const identity: CharacterIdentity = {
      id,
      seriesId: input.seriesId,
      characterName: input.characterName,
      references: input.references,
      consentRef: input.consentRef,
      realLikeness: input.realLikeness,
      createdAt: new Date().toISOString(),
    };
    this.identities.set(id, identity);
    this.shots.set(id, []);
    return identity;
  }

  async get(id: string): Promise<CharacterIdentity | null> {
    return this.identities.get(id) ?? null;
  }

  async listDerivedShots(identityId: string): Promise<DerivedShot[]> {
    return [...(this.shots.get(identityId) ?? [])];
  }

  async recordDerivedShot(shot: Omit<DerivedShot, "id" | "createdAt">): Promise<DerivedShot> {
    const full: DerivedShot = { ...shot, id: randomUUID(), createdAt: new Date().toISOString() };
    const list = this.shots.get(shot.identityId) ?? [];
    list.push(full);
    this.shots.set(shot.identityId, list);
    return full;
  }

  async purge(id: string): Promise<PurgeResult> {
    const existed = this.identities.delete(id);
    const derived = this.shots.get(id) ?? [];
    this.shots.delete(id);
    return { identityDeleted: existed, derivedShotsDeleted: derived.length };
  }
}
