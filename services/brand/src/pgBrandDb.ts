// Production BrandDB over node-postgres. The handlers depend only on the BrandDB interface; this is the
// real adapter, bound to the additive mobile.* brand-rail tables (scripts/sql/10_brand_rail.sql). It runs
// under the service role and assumes search_path=mobile (set DB_OPTIONS=-c search_path=mobile,public).
//
// `pg` is imported TYPE-ONLY so this file type-checks without the runtime dependency hoisted into a fresh
// workspace install (mirrors services/economy/src/pgEconomyDb.ts). serve.ts dynamically imports the pg
// runtime only when DATABASE_URL is present. The billing path posts a balanced double-entry pair in ONE
// transaction so a partial post can never unbalance the ledger. No em dashes.

import type pg from "pg";
import { billableCents, buildLedgerEntry } from "./billing.js";
import type {
  BrandAccount,
  BrandCampaign,
  BrandPerformance,
  LedgerLine,
  PlacementFill,
  PlacementSlot,
} from "./types.js";
import type { BrandDB } from "./store.js";

type Queryable = Pick<pg.Pool, "query" | "connect">;

export class PgBrandDb implements BrandDB {
  constructor(private readonly db: Queryable) {}

  async createBrand(input: Omit<BrandAccount, "id" | "createdAt">): Promise<BrandAccount> {
    const r = await this.db.query(
      `insert into brand_accounts (name, kind, contact_email, approval_state)
       values ($1, $2, $3, $4) returning id, created_at`,
      [input.name, input.kind, input.contactEmail ?? null, input.approvalState],
    );
    return { ...input, id: r.rows[0].id as string, createdAt: String(r.rows[0].created_at) };
  }

  async listBrands(): Promise<BrandAccount[]> {
    const r = await this.db.query(`select * from brand_accounts order by created_at desc`);
    return r.rows.map(rowToBrand);
  }

  async createCampaign(input: Omit<BrandCampaign, "id" | "createdAt" | "spentCents">): Promise<BrandCampaign> {
    const r = await this.db.query(
      `insert into brand_campaigns
         (brand_id, product, category, targeting, deal_model, rate_cents, budget_cents, status, approval_state, freq_cap_per_viewer)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning id, created_at, spent_cents`,
      [
        input.brandId, input.product, input.category, JSON.stringify(input.targeting),
        input.dealModel, input.rateCents, input.budgetCents, input.status,
        input.approvalState, input.freqCapPerViewer,
      ],
    );
    return { ...input, id: r.rows[0].id as string, spentCents: Number(r.rows[0].spent_cents), createdAt: String(r.rows[0].created_at) };
  }

  async getCampaign(id: string): Promise<BrandCampaign | undefined> {
    const r = await this.db.query(`select * from brand_campaigns where id = $1`, [id]);
    return r.rows[0] ? rowToCampaign(r.rows[0]) : undefined;
  }

  async listCampaigns(brandId?: string): Promise<BrandCampaign[]> {
    const r = brandId
      ? await this.db.query(`select * from brand_campaigns where brand_id = $1 order by created_at desc`, [brandId])
      : await this.db.query(`select * from brand_campaigns order by created_at desc`);
    return r.rows.map(rowToCampaign);
  }

  async createSlot(input: Omit<PlacementSlot, "id" | "createdAt">): Promise<PlacementSlot> {
    const r = await this.db.query(
      `insert into placement_slots
         (series_id, beat_id, allowed_categories, canon_constraints, ground_truth_metadata, content_rating)
       values ($1,$2,$3,$4,$5,$6) returning id, created_at`,
      [
        input.seriesId, input.beatId, input.allowedCategories,
        JSON.stringify(input.canonConstraints), JSON.stringify(input.groundTruthMetadata), input.contentRating,
      ],
    );
    return { ...input, id: r.rows[0].id as string, createdAt: String(r.rows[0].created_at) };
  }

  async getSlot(id: string): Promise<PlacementSlot | undefined> {
    const r = await this.db.query(`select * from placement_slots where id = $1`, [id]);
    return r.rows[0] ? rowToSlot(r.rows[0]) : undefined;
  }

  async listSlots(seriesId?: string): Promise<PlacementSlot[]> {
    const r = seriesId
      ? await this.db.query(`select * from placement_slots where series_id = $1`, [seriesId])
      : await this.db.query(`select * from placement_slots`);
    return r.rows.map(rowToSlot);
  }

  async recordFill(input: Omit<PlacementFill, "id" | "createdAt">): Promise<PlacementFill> {
    const r = await this.db.query(
      `insert into placement_fills
         (slot_id, campaign_id, region, viewer_hash, creative_ref, c2pa_signed, article50, audit)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, created_at`,
      [
        input.slotId, input.campaignId, input.region, input.viewerHash ?? null,
        input.creativeRef, input.c2paSigned, input.article50, JSON.stringify(input.audit),
      ],
    );
    return { ...input, id: r.rows[0].id as string, createdAt: String(r.rows[0].created_at) };
  }

  async fillCountForViewer(campaignId: string, viewerHash: string): Promise<number> {
    const r = await this.db.query(
      `select count(*)::int as n from placement_fills where campaign_id = $1 and viewer_hash = $2`,
      [campaignId, viewerHash],
    );
    return Number(r.rows[0].n);
  }

  async recordPerformance(input: Omit<BrandPerformance, "id" | "createdAt">): Promise<BrandPerformance> {
    const r = await this.db.query(
      `insert into brand_performance (fill_id, screen_time, completion, attention, propensity)
       values ($1,$2,$3,$4,$5) returning id, created_at`,
      [input.fillId, input.screenTime, input.completion, input.attention, input.propensity],
    );
    return { ...input, id: r.rows[0].id as string, createdAt: String(r.rows[0].created_at) };
  }

  async listPerformance(fillId?: string): Promise<BrandPerformance[]> {
    const r = fillId
      ? await this.db.query(`select * from brand_performance where fill_id = $1 order by created_at desc`, [fillId])
      : await this.db.query(`select * from brand_performance order by created_at desc`);
    return r.rows.map(rowToPerf);
  }

  // Post the balanced double-entry pair in ONE transaction. The unique index on (client_txn_id, account)
  // makes a replayed billing event a no-op (on conflict do nothing), so a retried fill cannot double-bill.
  async bill(campaignId: string, fill: PlacementFill, clientTxnId: string, opts?: { actions?: number }): Promise<LedgerLine[]> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) throw new Error("campaign_not_found");
    const amount = billableCents(campaign, opts);
    const lines = buildLedgerEntry(campaign, fill, amount, clientTxnId);
    if (lines.length === 0) return [];
    const client = await this.db.connect();
    try {
      await client.query("begin");
      const posted: LedgerLine[] = [];
      for (const l of lines) {
        const r = await client.query(
          `insert into brand_ledger_entries (entry_id, campaign_id, fill_id, account, direction, amount_cents, client_txn_id, mode)
           values ($1,$2,$3,$4,$5,$6,$7,'test')
           on conflict (client_txn_id, account) do nothing
           returning id`,
          [l.entryId, l.campaignId, l.fillId ?? null, l.account, l.direction, l.amountCents, l.clientTxnId],
        );
        if (r.rows.length > 0) posted.push(l);
      }
      // Recognize spend only when the pair actually posted (not a replay).
      if (posted.length > 0) {
        await client.query(`update brand_campaigns set spent_cents = spent_cents + $1 where id = $2`, [amount, campaignId]);
      }
      await client.query("commit");
      return posted;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  async ledgerFor(campaignId: string): Promise<LedgerLine[]> {
    const r = await this.db.query(`select * from brand_ledger_entries where campaign_id = $1 order by id`, [campaignId]);
    return r.rows.map(rowToLine);
  }
}

function rowToBrand(r: Record<string, unknown>): BrandAccount {
  return {
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as BrandAccount["kind"],
    ...(r.contact_email ? { contactEmail: String(r.contact_email) } : {}),
    approvalState: r.approval_state as BrandAccount["approvalState"],
    createdAt: String(r.created_at),
  };
}

function rowToCampaign(r: Record<string, unknown>): BrandCampaign {
  return {
    id: String(r.id),
    brandId: String(r.brand_id),
    product: String(r.product),
    category: String(r.category),
    targeting: typeof r.targeting === "string" ? JSON.parse(r.targeting) : (r.targeting as BrandCampaign["targeting"]),
    dealModel: r.deal_model as BrandCampaign["dealModel"],
    rateCents: Number(r.rate_cents),
    budgetCents: Number(r.budget_cents),
    spentCents: Number(r.spent_cents),
    status: r.status as BrandCampaign["status"],
    approvalState: r.approval_state as BrandCampaign["approvalState"],
    freqCapPerViewer: Number(r.freq_cap_per_viewer),
    createdAt: String(r.created_at),
  };
}

function rowToSlot(r: Record<string, unknown>): PlacementSlot {
  return {
    id: String(r.id),
    seriesId: String(r.series_id),
    beatId: String(r.beat_id),
    allowedCategories: (r.allowed_categories as string[]) ?? [],
    canonConstraints: typeof r.canon_constraints === "string" ? JSON.parse(r.canon_constraints) : (r.canon_constraints as PlacementSlot["canonConstraints"]),
    groundTruthMetadata: typeof r.ground_truth_metadata === "string" ? JSON.parse(r.ground_truth_metadata) : (r.ground_truth_metadata as PlacementSlot["groundTruthMetadata"]),
    contentRating: r.content_rating as PlacementSlot["contentRating"],
    createdAt: String(r.created_at),
  };
}

function rowToPerf(r: Record<string, unknown>): BrandPerformance {
  return {
    id: String(r.id),
    fillId: String(r.fill_id),
    screenTime: Number(r.screen_time),
    completion: Number(r.completion),
    attention: Number(r.attention),
    propensity: Number(r.propensity),
    createdAt: String(r.created_at),
  };
}

function rowToLine(r: Record<string, unknown>): LedgerLine {
  return {
    entryId: String(r.entry_id),
    campaignId: String(r.campaign_id),
    ...(r.fill_id ? { fillId: String(r.fill_id) } : {}),
    account: r.account as LedgerLine["account"],
    direction: r.direction as LedgerLine["direction"],
    amountCents: Number(r.amount_cents),
    clientTxnId: String(r.client_txn_id),
    mode: "test",
    createdAt: String(r.created_at),
  };
}
