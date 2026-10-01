// Creator-scoped dashboard numbers: the same shape as the operator overview (AdminOverview) so the studio
// dashboard renders unchanged, but counted over the signed-in creator's OWN series only. The platform-wide
// overview stays behind the service secret (/admin/overview). "ledger" here is the creator's earnings side:
// unlocks of their premium cuts and the coins those unlocks cost viewers. No em dashes.
import type { Query } from "./ownership.js";
import type { AdminOverview } from "./content.js";

export function creatorOverview(query: Query) {
  return async (ownerId: string): Promise<AdminOverview> => {
    const num = (v: unknown): number => (v == null ? 0 : Number(v));
    const owned = "select id from series where owner_id = $1";
    const series = (
      await query(
        "select count(*)::int as total, count(*) filter (where published_at is not null)::int as published from series where owner_id = $1",
        [ownerId],
      )
    ).rows[0];
    const variants = (
      await query(
        `select count(*)::int as total,
                count(*) filter (where v.is_premium)::int as premium,
                count(*) filter (where v.qa_status = 'passed')::int as qa_passed,
                count(*) filter (where v.caption_doc_url is not null)::int as with_captions,
                count(*) filter (where v.audio_description_url is not null)::int as with_ad,
                count(*) filter (where v.sign_video_url is not null)::int as with_sign,
                count(*) filter (where v.dub_audio_urls is not null and v.dub_audio_urls::text <> '{}')::int as with_dub
           from beat_variants v join beats b on b.id = v.beat_id
          where b.series_id in (${owned})`,
        [ownerId],
      )
    ).rows[0];
    const unlocks = (
      await query(
        `select count(*)::int as n, coalesce(sum(v.coin_cost), 0)::int as coins
           from entitlements e join beat_variants v on v.id = e.scope_id join beats b on b.id = v.beat_id
          where e.scope = 'beat_variant' and b.series_id in (${owned})`,
        [ownerId],
      )
    ).rows[0];
    const decisions = (
      await query(
        `select count(*)::int as n from decision_log d join beats b on b.id = d.beat_id where b.series_id in (${owned})`,
        [ownerId],
      )
    ).rows[0];
    return {
      series: { published: num(series?.published), total: num(series?.total) },
      variants: {
        total: num(variants?.total),
        premium: num(variants?.premium),
        qaPassed: num(variants?.qa_passed),
        withCaptions: num(variants?.with_captions),
        withAudioDescription: num(variants?.with_ad),
        withSign: num(variants?.with_sign),
        withDub: num(variants?.with_dub),
      },
      ledger: {
        transactions: num(unlocks?.n),
        coinsGranted: 0,
        coinsSpent: num(unlocks?.coins),
        byType: [{ type: "premium_unlock", count: num(unlocks?.n), coins: num(unlocks?.coins) }],
        wallets: 0,
        walletBalance: 0,
      },
      decisions: num(decisions?.n),
    };
  };
}
