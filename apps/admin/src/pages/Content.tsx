// CONTENT CMS (/admin/content). The entity tree (channel -> series -> episode -> variant) on the left and
// a table of the series with StatusChip on the right, both from GET /admin/content. Each series row links
// to its detail view (/admin/content/:id) from GET /admin/content/:id. READ-ONLY this wave: the "New
// series" and "Edit" affordances are rendered DISABLED with a "coming soon" hint (no dead end); editing +
// publish states come later. RBAC: the create/edit affordance is only shown to roles that will own it,
// and is inert regardless this wave. WCAG 2.2 AA. No emojis, no em dashes.
import { A11yBadge, Skeleton, StatusChip } from "@axessplayer/ui";
import { useContentList } from "../api/useAdminData";
import type { ContentNode } from "../api/adminApi";
import { PageHead } from "./Page";
import { Link } from "../router/router";
import { useRole } from "../access/useRole";

function flattenSeries(tree: ContentNode[]): ContentNode[] {
  const out: ContentNode[] = [];
  for (const channel of tree) {
    for (const child of channel.children ?? []) {
      if (child.kind === "series") out.push({ ...child, channel: channel.title });
    }
  }
  return out;
}

function TreeRow({ node, depth }: { node: ContentNode; depth: number }) {
  const linkable = node.kind === "series" || node.kind === "episode" || node.kind === "variant";
  const inner = (
    <>
      <span className="adm-tree__kind">{node.kind}</span>
      <span>{node.title}</span>
      <span style={{ marginLeft: "auto" }}>
        <StatusChip status={node.status} />
      </span>
    </>
  );
  return (
    <>
      {linkable ? (
        <Link to={`/admin/content/${node.id}`} className="adm-tree__row" style={{ paddingLeft: 10 + depth * 16 }}>
          {inner}
        </Link>
      ) : (
        <div className="adm-tree__row" style={{ paddingLeft: 10 + depth * 16 }}>
          {inner}
        </div>
      )}
      {node.children?.map((c) => (
        <TreeRow key={c.id} node={c} depth={depth + 1} />
      ))}
    </>
  );
}

export function Content() {
  const { data, loading, source } = useContentList();
  const { can } = useRole();
  const canCreate = can("content.edit");

  const series = data ? flattenSeries(data.tree) : [];

  return (
    <section className="adm-page">
      <PageHead
        title="Content CMS"
        subtitle="Channels, series, episodes, and variants. Read-only this wave; editing and publish states arrive next."
        right={
          canCreate ? (
            <button className="adm-soon" disabled aria-disabled title="Creating series is coming in a later wave">
              + New series (coming soon)
            </button>
          ) : undefined
        }
        source={source}
      />

      {loading || !data ? (
        <Skeleton height={320} radius={14} />
      ) : (
        <div className="adm-two-col">
          {/* entity tree */}
          <section className="adm-card" aria-label="Content tree">
            <h2 className="adm-card__title" style={{ marginBottom: 12 }}>
              Channels, series, episodes, variants
            </h2>
            <div className="adm-tree">
              {data.tree.map((n) => (
                <TreeRow key={n.id} node={n} depth={0} />
              ))}
            </div>
          </section>

          {/* series table */}
          <section className="adm-table" aria-label="Series">
            <div className="adm-tr adm-thead">
              <span>TITLE</span>
              <span>CHANNEL</span>
              <span>STATUS</span>
              <span>VARIANTS</span>
              <span>A11Y</span>
              <span>PROVENANCE</span>
            </div>
            {series.map((s) => (
              <Link key={s.id} to={`/admin/content/${s.id}`} className="adm-row-link adm-tr" aria-label={`Open ${s.title}`}>
                <span className="adm-cell-title">{s.title}</span>
                <span className="adm-cell-muted">{s.channel ?? "—"}</span>
                <span>
                  <StatusChip status={s.status} />
                </span>
                <span className="adm-cell-mono">{s.variantCount != null ? `${s.variantCount} variants` : "—"}</span>
                <span className="adm-cell-mono">{s.a11yCoverage != null ? `${s.a11yCoverage}%` : "—"}</span>
                <span>{s.provenanceVerified ? <A11yBadge kind="c2pa" /> : <span className="adm-cell-muted">—</span>}</span>
              </Link>
            ))}
          </section>
        </div>
      )}
    </section>
  );
}
