// The profile screen, matching the prototype's "You" tab: a rose-to-gold gradient avatar, the
// member line with the live coin balance, and a list of rows (Continue watching, My list,
// Accessibility defaults, Downloads). The rows are presentational in this slice. No em dashes.

export interface ProfileProps {
  name: string;
  coins: number | null;
}

export function Profile({ name, coins }: ProfileProps) {
  return (
    <div className="pad" data-testid="profile">
      <div className="profhead">
        <div className="avatar" aria-hidden="true" />
        <div>
          <div className="nm">{name}</div>
          <div className="muted">Member · {coins ?? "…"} coins</div>
        </div>
      </div>

      <div className="row">
        <div className="ic" aria-hidden="true">▤</div>
        <div style={{ flex: 1 }}>Continue watching</div>
      </div>
      <div className="row">
        <div className="ic" aria-hidden="true">♡</div>
        <div style={{ flex: 1 }}>My list</div>
      </div>
      <div className="row">
        <div className="ic" aria-hidden="true">⚙</div>
        <div style={{ flex: 1 }}>Accessibility defaults</div>
      </div>
      <div className="row">
        <div className="ic" aria-hidden="true">⤓</div>
        <div style={{ flex: 1 }}>Downloads</div>
      </div>
    </div>
  );
}
