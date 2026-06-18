// Shared page scaffold: a title/subtitle head plus optional right-side controls, and a "demo data" note
// when a surface is rendering the synthetic fixture (the live service was unreachable). No em dashes.
import type { DataSource } from "../api/useAdminData";

export function PageHead({
  title,
  subtitle,
  right,
  source,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  source?: DataSource;
}) {
  return (
    <div className="adm-page__head">
      <div>
        <h1 className="adm-page__title">{title}</h1>
        {subtitle && <p className="adm-page__sub">{subtitle}</p>}
        {source === "demo" && (
          <p className="adm-note" style={{ marginTop: 8 }}>
            Demo data · live admin API not reachable
          </p>
        )}
      </div>
      {right && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{right}</div>}
    </div>
  );
}
