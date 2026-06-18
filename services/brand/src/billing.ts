// Brand marketplace billing. Every billable placement posts a balanced DOUBLE-ENTRY pair: debit the
// campaign budget account, credit the platform revenue account, under one entry_id. Reconciliation SUMS the
// lines per campaign and asserts debits == credits (the invariant a ledger must always hold). TEST MODE
// ONLY: this produces ledger entries, it NEVER represents a live card charge (Stripe stays test). No em
// dashes.

import type { BrandCampaign, LedgerLine, PlacementFill } from "./types.js";

// Amount billed for one fill under the campaign's deal model. CPM bills per-thousand-impressions (one fill
// = one impression here), CPC/CPA bill on the reported action, flat bills the rate once. Cents, integer.
export function billableCents(campaign: BrandCampaign, opts: { actions?: number } = {}): number {
  const actions = opts.actions ?? 1;
  switch (campaign.dealModel) {
    case "CPM":
      return Math.round((campaign.rateCents * actions) / 1000);
    case "CPC":
    case "CPA":
      return campaign.rateCents * actions;
    case "flat":
      return campaign.rateCents;
    default:
      return 0;
  }
}

// Build the balanced double-entry pair for a billable fill. Two lines share one entryId and one
// client_txn_id-derived dedupe key so a replayed billing event is a no-op at the store. amount must be > 0
// to post (a zero-cost fill posts nothing).
export function buildLedgerEntry(
  campaign: BrandCampaign,
  fill: PlacementFill | { id: string },
  amountCents: number,
  clientTxnId: string,
  now: () => string = () => new Date().toISOString(),
): LedgerLine[] {
  if (amountCents <= 0) return [];
  const entryId = `bre-${clientTxnId}`;
  const createdAt = now();
  const base = {
    entryId,
    campaignId: campaign.id,
    fillId: fill.id,
    amountCents,
    mode: "test" as const,
    createdAt,
  };
  return [
    { ...base, account: "campaign_budget", direction: "debit", clientTxnId: `${clientTxnId}:campaign_budget` },
    { ...base, account: "platform_revenue", direction: "credit", clientTxnId: `${clientTxnId}:platform_revenue` },
  ];
}

export type Reconciliation = {
  campaignId: string;
  debitCents: number;
  creditCents: number;
  balanced: boolean;
  spentCents: number; // = debits to campaign_budget, the campaign's recognized spend
  lineCount: number;
};

// Reconcile a campaign's ledger lines: sum debits and credits, assert they match, and surface the spend.
// balanced is the load-bearing invariant the invoice endpoint reports.
export function reconcileCampaign(campaignId: string, lines: LedgerLine[]): Reconciliation {
  const own = lines.filter((l) => l.campaignId === campaignId);
  let debitCents = 0;
  let creditCents = 0;
  let spentCents = 0;
  for (const l of own) {
    if (l.direction === "debit") {
      debitCents += l.amountCents;
      if (l.account === "campaign_budget") spentCents += l.amountCents;
    } else {
      creditCents += l.amountCents;
    }
  }
  return {
    campaignId,
    debitCents,
    creditCents,
    balanced: debitCents === creditCents,
    spentCents,
    lineCount: own.length,
  };
}
