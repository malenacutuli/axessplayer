// Clear sponsorship disclosure (FTC endorsement guides; EU AI Act Article 50 style labelling for any
// synthetic placement). Always visible text, never only an icon. No em dashes.
export function SponsorCard({ sponsor, compact = false }: { sponsor: { brand: string; disclosure: string }; compact?: boolean }) {
  return (
    <p className={`sponsor${compact ? " sponsor--compact" : ""}`} role="note" aria-label={sponsor.disclosure} data-testid="sponsor-card">
      <span className="sponsor__label">Sponsored</span> {sponsor.disclosure}
    </p>
  );
}
