// The explicit coming-soon empty state for the not-yet-built rail sections. Each of the 16 rail items
// routes to a REAL route; the ones not built in this wave land here, reachable, with a clear "coming soon"
// message and a way back (no dead end). Uses the shared EmptyState + Button. No em dashes.
import { Button, EmptyState } from "@axessplayer/ui";
import { PageHead } from "./Page";
import { useRouter } from "../router/router";

export function ComingSoon({ title, subtitle }: { title: string; subtitle?: string }) {
  const { navigate } = useRouter();
  return (
    <section className="adm-page">
      <PageHead
        title={title}
        subtitle={subtitle ?? "This operator surface is on the build roadmap."}
      />
      <EmptyState
        title="Coming soon"
        action={<Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>}
      >
        This section is reachable and routed. The interactive view ships in a later wave; nothing here is a
        dead end.
      </EmptyState>
    </section>
  );
}
