// BrandDB port + in-memory store. The HTTP handlers depend ONLY on this interface; the pg adapter
// (pgBrandDb.ts) is the production implementation and the in-memory store backs unit tests and local
// wiring. The store is the BRAND/AD plane system of record. It exposes NO method that reads or writes any
// content-ranking / decision table: the firewall is structural (there is simply no such method). No em
// dashes.

import { buildLedgerEntry, billableCents } from "./billing.js";
import type {
  BrandAccount,
  BrandCampaign,
  BrandPerformance,
  LedgerLine,
  PlacementFill,
  PlacementSlot,
} from "./types.js";

export interface BrandDB {
  // accounts
  createBrand(input: Omit<BrandAccount, "id" | "createdAt">): Promise<BrandAccount>;
  listBrands(): Promise<BrandAccount[]>;
  // campaigns
  createCampaign(input: Omit<BrandCampaign, "id" | "createdAt" | "spentCents">): Promise<BrandCampaign>;
  getCampaign(id: string): Promise<BrandCampaign | undefined>;
  listCampaigns(brandId?: string): Promise<BrandCampaign[]>;
  // slots
  createSlot(input: Omit<PlacementSlot, "id" | "createdAt">): Promise<PlacementSlot>;
  getSlot(id: string): Promise<PlacementSlot | undefined>;
  listSlots(seriesId?: string): Promise<PlacementSlot[]>;
  // fills
  recordFill(input: Omit<PlacementFill, "id" | "createdAt">): Promise<PlacementFill>;
  fillCountForViewer(campaignId: string, viewerHash: string): Promise<number>;
  // performance
  recordPerformance(input: Omit<BrandPerformance, "id" | "createdAt">): Promise<BrandPerformance>;
  listPerformance(fillId?: string): Promise<BrandPerformance[]>;
  // billing: post a balanced double-entry pair idempotently. Returns the lines actually posted (empty on a
  // replay or a zero-cost fill). Also advances the campaign spent_cents by the debit.
  bill(campaignId: string, fill: PlacementFill, clientTxnId: string, opts?: { actions?: number }): Promise<LedgerLine[]>;
  ledgerFor(campaignId: string): Promise<LedgerLine[]>;
}

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function createInMemoryBrandDB(now: () => string = () => new Date().toISOString()): BrandDB {
  const brands = new Map<string, BrandAccount>();
  const campaigns = new Map<string, BrandCampaign>();
  const slots = new Map<string, PlacementSlot>();
  const fills: PlacementFill[] = [];
  const performance: BrandPerformance[] = [];
  const ledger: LedgerLine[] = [];
  const postedTxns = new Set<string>();

  return {
    async createBrand(input) {
      const a: BrandAccount = { ...input, id: id("brand"), createdAt: now() };
      brands.set(a.id, a);
      return a;
    },
    async listBrands() {
      return [...brands.values()];
    },
    async createCampaign(input) {
      const c: BrandCampaign = { ...input, id: id("camp"), spentCents: 0, createdAt: now() };
      campaigns.set(c.id, c);
      return c;
    },
    async getCampaign(cid) {
      return campaigns.get(cid);
    },
    async listCampaigns(brandId) {
      const all = [...campaigns.values()];
      return brandId ? all.filter((c) => c.brandId === brandId) : all;
    },
    async createSlot(input) {
      const s: PlacementSlot = { ...input, id: id("slot"), createdAt: now() };
      slots.set(s.id, s);
      return s;
    },
    async getSlot(sid) {
      return slots.get(sid);
    },
    async listSlots(seriesId) {
      const all = [...slots.values()];
      return seriesId ? all.filter((s) => s.seriesId === seriesId) : all;
    },
    async recordFill(input) {
      const f: PlacementFill = { ...input, id: id("fill"), createdAt: now() };
      fills.push(f);
      return f;
    },
    async fillCountForViewer(campaignId, viewerHash) {
      return fills.filter((f) => f.campaignId === campaignId && f.viewerHash === viewerHash).length;
    },
    async recordPerformance(input) {
      const p: BrandPerformance = { ...input, id: id("perf"), createdAt: now() };
      performance.push(p);
      return p;
    },
    async listPerformance(fillId) {
      return fillId ? performance.filter((p) => p.fillId === fillId) : [...performance];
    },
    async bill(campaignId, fill, clientTxnId, opts) {
      const campaign = campaigns.get(campaignId);
      if (!campaign) throw new Error("campaign_not_found");
      if (postedTxns.has(clientTxnId)) return []; // idempotent replay: no-op
      const amount = billableCents(campaign, opts);
      const lines = buildLedgerEntry(campaign, fill, amount, clientTxnId, now);
      if (lines.length === 0) return [];
      postedTxns.add(clientTxnId);
      ledger.push(...lines);
      // Recognize spend = the debit to campaign_budget. Keeps spent_cents reconcilable to the ledger.
      campaign.spentCents += amount;
      campaigns.set(campaignId, campaign);
      return lines;
    },
    async ledgerFor(campaignId) {
      return ledger.filter((l) => l.campaignId === campaignId);
    },
  };
}
