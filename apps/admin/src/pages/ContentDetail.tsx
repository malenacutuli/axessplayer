// CONTENT DETAIL (/admin/content/:id). Read-only detail of a content node from GET /admin/content/:id.
// Editing + publish states come later, shown DISABLED with a "coming soon" affordance (no dead end). RBAC:
// the edit/publish controls are only shown to roles that own them (content.edit / content.publish) and are
// inert this wave. A back link returns to the CMS. WCAG 2.2 AA. No emojis, no em dashes.
import { A11yBadge, ErrorState, Skeleton, StatusChip, Button } from "@axessplayer/ui";
import { useContentDetail } from "../api/useAdminData";
import { PageHead } from "./Page";
import { Link, useRouter } from "../router/router";
import { useRole } from "../access/useRole";

export function ContentDetail({ id }: { id: string }) {
  const { data, loading, error, source } = useContentDetail(id);
  const { can } = useRole();
  const { navigate } = useRouter();

  if (loading) {
    return (
      <section className="adm-page">
        <PageHead title="Content detail" />
        <Skeleton height={260} radius={14} />
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="adm-page">
        <PageHead title="Content detail" />
        <ErrorState
          title="Not found"
          action={<Button variant="secondary" onClick={() => navigate("/admin/content")}>Back to Content CMS</Button>}
        >
          No content node with id {id}.
        </ErrorState>
      </section>
    );
  }

  const node = data.node;

  return (
    <section className="adm-page">
      <PageHead
        title={node.title}
        subtitle={`${node.kind}${node.channel ? ` · ${node.channel}` : ""}`}
        right={
          <>
            {can("content.edit") && (
              <button className="adm-soon" disabled aria-disabled title="Editing is coming in a later wave">
                Edit (coming soon)
              </button>
            )}
            {can("content.publish") && (
              <button className="adm-soon" disabled aria-disabled title="Publishing is coming in a later wave">
                Publish (coming soon)
              </button>
            )}
          </>
        }
        source={source}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <StatusChip status={node.status} />
        {node.provenanceVerified && <A11yBadge kind="c2pa" />}
        <Link to="/admin/content" className="adm-cell-muted">
          Back to Content CMS
        </Link>
      </div>

      <section className="adm-card" aria-label="Detail">
        <div className="adm-meta">
          {data.meta.map((m) => (
            <div key={m.label} className="adm-meta__row">
              <span className="adm-meta__k">{m.label}</span>
              <span className="adm-meta__v">{m.value}</span>
            </div>
          ))}
        </div>
      </section>

      {node.children && node.children.length > 0 && (
        <section className="adm-card" style={{ marginTop: 14 }} aria-label="Children">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>
            Contains
          </h2>
          <div className="adm-tree">
            {node.children.map((c) => (
              <Link key={c.id} to={`/admin/content/${c.id}`} className="adm-tree__row">
                <span className="adm-tree__kind">{c.kind}</span>
                <span>{c.title}</span>
                <span style={{ marginLeft: "auto" }}>
                  <StatusChip status={c.status} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
