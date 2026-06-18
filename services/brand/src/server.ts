// Brand revenue-rail HTTP surface (prompt 19). node:http server on PORT 8104, mirroring the monetization
// service pattern (createServer, JSON helpers, advertiser/operator verifier stub). Endpoints:
//   GET/POST  /brands             list / create brand accounts (operator)
//   GET/POST  /campaigns          list / create campaigns (advertiser owns; operator may create for any)
//   GET/POST  /placements         list / create placement slots (operator)
//   POST      /placements/:id/fill   programmatic fill -> fill or { blocked, reason } (operator)
//   GET       /performance        brand-performance rows (separate plane); POST logs one
//   GET       /invoice/:campaignId reconciled invoice (double-entry, balanced)
//
// HARD GATES enforced here: brand-safety + canon-safety reject a disallowed pairing BEFORE a fill (returns
// blocked+reason); every filled slot is C2PA-signed + Article-50 disclosed + an immutable audit record;
// billing posts balanced double-entry ledger lines (TEST mode) that the invoice reconciles. The CONTENT/AD
// firewall is structural: this server only touches the BrandDB (brand-plane tables), never content ranking.
// No em dashes.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { parseBearer, type Verifiers } from "./auth.js";
import { placeFill } from "./placement.js";
import { rerankCandidates } from "./flywheel.js";
import { reconcileCampaign } from "./billing.js";
import type { BrandDB } from "./store.js";
import type { DemandAdapter } from "./demand.js";
import type {
  BrandAccount,
  BrandCampaign,
  BrandPerformance,
  FillCandidate,
  PlacementSlot,
  ViewerContext,
} from "./types.js";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, accept",
};

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...CORS });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
}

export interface BrandServerDeps {
  db: BrandDB;
  verifiers: Verifiers;
  demand: DemandAdapter;
  now?: () => string;
}

export function createBrandServer(deps: BrandServerDeps): Server {
  const { db, verifiers, demand } = deps;
  const bearer = (req: IncomingMessage) => parseBearer(req.headers.authorization);

  return createServer((req, res) => {
    void (async () => {
      try {
        const method = (req.method ?? "GET").toUpperCase();
        const url = req.url ?? "/";
        const path = url.split("?")[0];

        if (method === "OPTIONS") {
          res.writeHead(204, CORS);
          return res.end();
        }
        if (path === "/healthz") return send(res, 200, { ok: true });

        const isOperator = await verifiers.operator.verifyOperator(bearer(req));
        const advertiser = await verifiers.advertiser.verifyAdvertiser(bearer(req));

        // ---- /brands (operator) ----
        if (path === "/brands") {
          if (method === "GET") return send(res, 200, { brands: await db.listBrands() });
          if (method === "POST") {
            if (!isOperator) return send(res, 403, { error: "operator_required" });
            const b = await readJson<Partial<BrandAccount>>(req);
            if (!b.name) return send(res, 400, { error: "name_required" });
            const created = await db.createBrand({
              name: b.name,
              kind: b.kind === "agency" ? "agency" : "brand",
              ...(b.contactEmail ? { contactEmail: b.contactEmail } : {}),
              approvalState: b.approvalState ?? "pending",
            });
            return send(res, 201, { brand: created });
          }
        }

        // ---- /campaigns (advertiser owns; operator may act for any) ----
        if (path === "/campaigns") {
          if (method === "GET") {
            const brandId = new URL(url, "http://x").searchParams.get("brandId") ?? undefined;
            return send(res, 200, { campaigns: await db.listCampaigns(brandId) });
          }
          if (method === "POST") {
            if (!isOperator && !advertiser) return send(res, 401, { error: "auth_required" });
            const c = await readJson<Partial<BrandCampaign>>(req);
            if (!c.brandId || !c.product || !c.category || !c.dealModel) {
              return send(res, 400, { error: "brandId, product, category, dealModel required" });
            }
            const created = await db.createCampaign({
              brandId: c.brandId,
              product: c.product,
              category: c.category,
              targeting: c.targeting ?? {},
              dealModel: c.dealModel,
              rateCents: c.rateCents ?? 0,
              budgetCents: c.budgetCents ?? 0,
              status: c.status ?? "draft",
              // Only an operator may approve; an advertiser-created campaign stays pending.
              approvalState: isOperator ? c.approvalState ?? "pending" : "pending",
              freqCapPerViewer: c.freqCapPerViewer ?? 3,
            });
            return send(res, 201, { campaign: created });
          }
        }

        // ---- /placements (slots) ----
        if (path === "/placements") {
          if (method === "GET") {
            const seriesId = new URL(url, "http://x").searchParams.get("seriesId") ?? undefined;
            return send(res, 200, { slots: await db.listSlots(seriesId) });
          }
          if (method === "POST") {
            if (!isOperator) return send(res, 403, { error: "operator_required" });
            const s = await readJson<Partial<PlacementSlot>>(req);
            if (!s.seriesId || !s.beatId) return send(res, 400, { error: "seriesId, beatId required" });
            const created = await db.createSlot({
              seriesId: s.seriesId,
              beatId: s.beatId,
              allowedCategories: s.allowedCategories ?? [],
              canonConstraints: s.canonConstraints ?? {},
              groundTruthMetadata: s.groundTruthMetadata ?? {},
              contentRating: s.contentRating ?? "PG",
            });
            return send(res, 201, { slot: created });
          }
        }

        // ---- POST /placements/:id/fill (operator) ----
        const fillMatch = /^\/placements\/([^/]+)\/fill$/.exec(path);
        if (fillMatch && method === "POST") {
          if (!isOperator) return send(res, 403, { error: "operator_required" });
          const slotId = decodeURIComponent(fillMatch[1]);
          const slot = await db.getSlot(slotId);
          if (!slot) return send(res, 404, { error: "slot_not_found" });
          const body = await readJson<{ candidates?: FillCandidate[]; viewer?: ViewerContext }>(req);
          const rawCandidates = body.candidates ?? [];
          const viewer = body.viewer ?? {};

          // Pre-warm the synchronous dependency reads placeFill expects: resolve each candidate's campaign
          // and the per-viewer fill counts up front (the store is async; placeFill is given pure closures).
          const campaigns = new Map<string, BrandCampaign>();
          const fillCounts = new Map<string, number>();
          const history = new Map<string, BrandPerformance[]>();
          for (const c of rawCandidates) {
            if (!campaigns.has(c.campaignId)) {
              const camp = await db.getCampaign(c.campaignId);
              if (camp) campaigns.set(c.campaignId, camp);
            }
            if (viewer.viewerHash) {
              const key = `${c.campaignId}:${viewer.viewerHash}`;
              if (!fillCounts.has(key)) {
                fillCounts.set(key, await db.fillCountForViewer(c.campaignId, viewer.viewerHash));
              }
            }
            // Learned brand-match history is keyed by creativeRef via the fills that produced each perf row.
            // Performance rows do not carry creativeRef directly, so an empty history yields the neutral
            // prior re-rank until the creativeRef->perf join is materialized in the pg adapter (flagged).
            if (!history.has(c.creativeRef)) history.set(c.creativeRef, []);
          }

          // Re-rank candidates by the learned BRAND-match objective (separate plane) before selection.
          const candidates = rerankCandidates(rawCandidates, history);

          const result = await placeFill(slot, candidates, viewer, {
            campaignFor: (cid) => campaigns.get(cid),
            demand,
            fillCountForViewer: (cid, vh) => fillCounts.get(`${cid}:${vh}`) ?? 0,
            ...(deps.now ? { now: deps.now } : {}),
          });
          if (!result.filled) return send(res, 200, { blocked: true, reason: result.reason });

          // Persist the fill (C2PA + Article 50 + immutable audit), log brand performance seed (propensity),
          // and bill via the double-entry ledger (TEST mode). client_txn_id dedupes a replayed fill.
          const fill = await db.recordFill({
            slotId: result.fill.slotId,
            campaignId: result.fill.campaignId,
            region: result.fill.region,
            ...(result.fill.viewerHash ? { viewerHash: result.fill.viewerHash } : {}),
            creativeRef: result.fill.creativeRef,
            c2paSigned: result.fill.c2paSigned,
            article50: result.fill.article50,
            audit: result.fill.audit,
          });
          await db.recordPerformance({
            fillId: fill.id,
            screenTime: 0,
            completion: 0,
            attention: 0,
            propensity: result.propensity,
          });
          const txn = `${fill.id}`;
          const lines = await db.bill(fill.campaignId, fill, txn);
          return send(res, 201, { fill, ledger: lines, propensity: result.propensity });
        }

        // ---- /performance (separate brand plane) ----
        if (path === "/performance") {
          if (method === "GET") {
            const fillId = new URL(url, "http://x").searchParams.get("fillId") ?? undefined;
            return send(res, 200, { performance: await db.listPerformance(fillId) });
          }
          if (method === "POST") {
            if (!isOperator) return send(res, 403, { error: "operator_required" });
            const p = await readJson<Partial<BrandPerformance>>(req);
            if (!p.fillId) return send(res, 400, { error: "fillId_required" });
            const rec = await db.recordPerformance({
              fillId: p.fillId,
              screenTime: p.screenTime ?? 0,
              completion: p.completion ?? 0,
              attention: p.attention ?? 0,
              propensity: p.propensity ?? 1,
            });
            return send(res, 201, { performance: rec });
          }
        }

        // ---- GET /invoice/:campaignId (reconciled, double-entry) ----
        const invMatch = /^\/invoice\/([^/]+)$/.exec(path);
        if (invMatch && method === "GET") {
          const campaignId = decodeURIComponent(invMatch[1]);
          const campaign = await db.getCampaign(campaignId);
          if (!campaign) return send(res, 404, { error: "campaign_not_found" });
          const lines = await db.ledgerFor(campaignId);
          const recon = reconcileCampaign(campaignId, lines);
          return send(res, 200, {
            campaignId,
            invoice: recon,
            mode: "test",
            // Reconciliation invariant surfaced for the caller: spent recognized == campaign.spent_cents.
            spentMatchesCampaign: recon.spentCents === campaign.spentCents,
            lines,
          });
        }

        return send(res, 404, { error: "not_found" });
      } catch (e) {
        if (!res.headersSent) send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });
}
