// Production TrustDB over a Postgres query interface (node-postgres Pool, or PGlite in tests, both of
// which expose query(sql, params)). Writes the trust tables this service owns: content_credentials and
// consent_ledger. The schema is frozen (supabase/migrations/0001_init.sql) and not altered here. The
// NOT NULL beat_variant_id FK on both tables is what enforces "no orphan provenance / no orphan
// consent": an insert with an unknown variant raises a foreign key violation. No em dashes.

import type {
  TrustDB,
  CredentialRow,
  ConsentInput,
  ConsentRow,
} from "./trust.js";
import type { SignedC2paManifest } from "./c2pa.js";
import type { ConsentContent } from "./hashChain.js";

// Minimal structural type covering pg.Pool and PGlite. Both return { rows }.
export interface QueryClient {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: R[] }>;
}

export class PgTrustDb implements TrustDB {
  constructor(private readonly db: QueryClient) {}

  async insertCredential(
    beatVariantId: string,
    manifest: SignedC2paManifest,
    tier: string
  ): Promise<CredentialRow> {
    const r = await this.db.query<{ id: string; beat_variant_id: string; manifest: SignedC2paManifest; tier: string }>(
      `insert into public.content_credentials (beat_variant_id, manifest, tier)
       values ($1, $2, $3)
       returning id, beat_variant_id, manifest, tier`,
      [beatVariantId, JSON.stringify(manifest), tier]
    );
    const row = r.rows[0];
    return {
      id: row.id,
      beat_variant_id: row.beat_variant_id,
      manifest: typeof row.manifest === "string" ? JSON.parse(row.manifest) : row.manifest,
      tier: row.tier,
    };
  }

  async getCredential(beatVariantId: string): Promise<CredentialRow | null> {
    const r = await this.db.query<{ id: string; beat_variant_id: string; manifest: SignedC2paManifest; tier: string }>(
      `select id, beat_variant_id, manifest, tier
       from public.content_credentials
       where beat_variant_id = $1
       order by created_at desc
       limit 1`,
      [beatVariantId]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    return {
      id: row.id,
      beat_variant_id: row.beat_variant_id,
      manifest: typeof row.manifest === "string" ? JSON.parse(row.manifest as unknown as string) : row.manifest,
      tier: row.tier,
    };
  }

  async getChainTip(beatVariantId: string): Promise<{ rowHash: string; createdAt: string } | null> {
    const r = await this.db.query<{ row_hash: string; created_at: string | Date }>(
      `select row_hash, created_at
       from public.consent_ledger
       where beat_variant_id = $1
       order by created_at desc
       limit 1`,
      [beatVariantId]
    );
    if (r.rows.length === 0) return null;
    return {
      rowHash: r.rows[0].row_hash,
      createdAt: new Date(r.rows[0].created_at).toISOString(),
    };
  }

  async insertConsent(
    input: ConsentInput,
    createdAt: string,
    prevHash: string | null,
    rowHash: string
  ): Promise<ConsentRow> {
    const royalty = input.royalty_terms ?? null;
    const r = await this.db.query<{
      id: string;
      likeness_subject: string;
      beat_variant_id: string;
      consent_ref: string;
      royalty_terms: unknown;
      prev_hash: string | null;
      row_hash: string;
      created_at: string;
    }>(
      `insert into public.consent_ledger
         (likeness_subject, beat_variant_id, consent_ref, royalty_terms, prev_hash, row_hash, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, likeness_subject, beat_variant_id, consent_ref, royalty_terms, prev_hash, row_hash, created_at`,
      [
        input.likeness_subject,
        input.beat_variant_id,
        input.consent_ref,
        royalty === null ? null : JSON.stringify(royalty),
        prevHash,
        rowHash,
        createdAt,
      ]
    );
    return this.toConsentRow(r.rows[0]);
  }

  async getConsentChain(beatVariantId: string): Promise<ConsentRow[]> {
    const r = await this.db.query<{
      id: string;
      likeness_subject: string;
      beat_variant_id: string;
      consent_ref: string;
      royalty_terms: unknown;
      prev_hash: string | null;
      row_hash: string;
      created_at: string;
    }>(
      `select id, likeness_subject, beat_variant_id, consent_ref, royalty_terms, prev_hash, row_hash, created_at
       from public.consent_ledger
       where beat_variant_id = $1
       order by created_at asc, id asc`,
      [beatVariantId]
    );
    return r.rows.map((row) => this.toConsentRow(row));
  }

  private toConsentRow(row: {
    id: string;
    likeness_subject: string;
    beat_variant_id: string;
    consent_ref: string;
    royalty_terms: unknown;
    prev_hash: string | null;
    row_hash: string;
    created_at: string | Date;
  }): ConsentRow {
    const royalty =
      typeof row.royalty_terms === "string" ? JSON.parse(row.royalty_terms) : row.royalty_terms ?? null;
    // Normalize the stored TIMESTAMPTZ back to the exact millisecond-precision ISO-8601 string the
    // service committed into the hash at insert time. PGlite and pg may hand back a Date or a string;
    // both represent the same instant, and ISO-8601 / JS Date are both millisecond precision, so this
    // round-trips byte-for-byte with the value passed to computeRowHash. Without this, format drift
    // between insert and read would make every row_hash recomputation fail spuriously.
    const createdAt = new Date(row.created_at).toISOString();
    const content: ConsentContent = {
      likeness_subject: row.likeness_subject,
      beat_variant_id: row.beat_variant_id,
      consent_ref: row.consent_ref,
      royalty_terms: royalty,
      created_at: createdAt,
    };
    return {
      id: row.id,
      prev_hash: row.prev_hash,
      row_hash: row.row_hash,
      content,
    };
  }
}
