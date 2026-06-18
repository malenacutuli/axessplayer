// SECTION 14 - TEAM (/studio/team). Multi-seat collaboration over the story graph, for AGENCY and
// PRODUCTION tiers only. A solo creator sees an UPGRADE prompt (never a dead end): it routes to Settings to
// change tier. For agency/production it surfaces:
//   - the SEAT list with roles and per-seat review-status stubs,
//   - asset / variant management at scale (a read summary of the team's pipeline),
//   - rights / consent records per title as a READ summary (the full rights workflow is a later wave).
// Invites and role changes are RBAC-gated coming-soon seams: shown, but no write endpoint exists yet, so
// they never fabricate a successful invite. Built on @axessplayer/ui (STUDIO skin). WCAG 2.2 AA. No emojis,
// no em dashes.
import { useState } from "react";
import { Button, EmptyState } from "@axessplayer/ui";
import { useCreatorAuth, tierInfo } from "../../auth/creatorAuth.js";
import type { SectionId } from "../../sections.js";

// Seat / role / review-status are presentation stubs: there is no team service or seat table yet, so these
// describe the shape of the collaboration surface without inventing real people. The CURRENT creator is the
// only real seat (the signed-in session); the rest of the surface is gated/empty.
type TeamRole = "owner" | "editor" | "reviewer" | "viewer";

const ROLE_LABEL: Record<TeamRole, string> = {
  owner: "Owner",
  editor: "Editor",
  reviewer: "Reviewer",
  viewer: "Viewer",
};

export interface TeamSectionProps {
  // Route back to a built section (used by the solo upgrade prompt to reach Settings). Typed against the
  // section ids the rail knows.
  onNavigate: (section: SectionId) => void;
}

export function TeamSection({ onNavigate }: TeamSectionProps): JSX.Element {
  const { session } = useCreatorAuth();
  const tier = session ? session.tier : "solo";
  const isTeamTier = tier === "agency" || tier === "production";

  return (
    <div className="spanel" data-testid="panel-team">
      <div className="sbar">
        <div>
          <div className="ey rose">Team</div>
          <h2 style={{ marginTop: 8 }}>Seats, roles, and review</h2>
          <p className="muted">Multi-seat collaboration and review over your story graph.</p>
        </div>
      </div>

      {!isTeamTier ? (
        <UpgradePrompt onNavigate={onNavigate} />
      ) : (
        <>
          <SeatList ownerName={session?.name ?? "You"} tierLabel={tierInfo(tier).label} />
          <AssetManagement />
          <RightsConsentSummary />
        </>
      )}
    </div>
  );
}

// Solo creators are not dead-ended: a clear upgrade path to Settings (where the tier switch lives).
function UpgradePrompt({ onNavigate }: { onNavigate: (section: SectionId) => void }): JSX.Element {
  return (
    <EmptyState
      title="Team is on the Agency and Production tiers"
      action={
        <Button onClick={() => onNavigate("settings")} data-testid="team-upgrade">
          Change tier in Settings
        </Button>
      }
    >
      <p className="muted" data-testid="team-upgrade-blurb">
        Invite collaborators, assign roles, and review the story graph together by upgrading to the Agency or
        Production tier. Your work stays yours; seats only add reviewers and editors you choose.
      </p>
    </EmptyState>
  );
}

function SeatList({ ownerName, tierLabel }: { ownerName: string; tierLabel: string }): JSX.Element {
  const [inviteOpen, setInviteOpen] = useState(false);
  return (
    <section aria-label="Seats and roles" data-testid="team-seats" style={{ marginTop: 14 }}>
      <div className="sbar" style={{ alignItems: "center" }}>
        <div className="scaption">Seats and roles ({tierLabel})</div>
        <Button variant="secondary" onClick={() => setInviteOpen((v) => !v)} data-testid="team-invite">
          Invite a seat
        </Button>
      </div>

      <ul className="team-seats" data-testid="team-seat-list">
        <li className="team-seat" data-testid="team-seat-owner">
          <div className="team-seat__who">
            <b>{ownerName}</b>
            <span className="muted">The signed-in owner</span>
          </div>
          <span className="chip on">{ROLE_LABEL.owner}</span>
          <span className="muted team-seat__review">Review: not required</span>
        </li>
      </ul>
      <p className="muted" data-testid="team-seats-empty" style={{ marginTop: 8 }}>
        You are the only seat so far. Invited editors, reviewers, and viewers appear here with their role and
        review status.
      </p>

      {inviteOpen && (
        <p className="muted" role="status" data-testid="team-invite-gated" style={{ marginTop: 8 }}>
          Inviting a seat and changing roles are permission-gated. The team and seat write endpoints are not
          built yet, so no invite is sent here (gated). Roles map to review rights over the story graph:
          {" "}{Object.values(ROLE_LABEL).join(", ")}.
        </p>
      )}
    </section>
  );
}

// Asset / variant management at scale: a read summary of the team's authoring pipeline. There is no team
// asset service yet, so this is an honest empty/coming-soon summary rather than a fabricated inventory.
function AssetManagement(): JSX.Element {
  return (
    <section aria-label="Asset and variant management" data-testid="team-assets" style={{ marginTop: 18 }}>
      <div className="scaption">Assets and variants at scale</div>
      <EmptyState title="Shared asset management is coming">
        <p className="muted" data-testid="team-assets-empty">
          A shared view of every master, variant, and accessibility track across your titles, with bulk
          assignment to reviewers, lands with the full team workflow. Today each title is managed in its own
          Library and Media sections.
        </p>
      </EmptyState>
    </section>
  );
}

// Rights / consent records per title as a READ summary. The full rights workflow (territories, licensing,
// likeness consent capture) is a later wave; here we surface a read-only summary scaffold, not a workflow.
function RightsConsentSummary(): JSX.Element {
  return (
    <section aria-label="Rights and consent records" data-testid="team-rights" style={{ marginTop: 18 }}>
      <div className="scaption">Rights and consent records (read summary)</div>
      <div className="inspcard" data-testid="team-rights-card">
        <ul className="team-rights">
          <li>
            <span>Likeness and biometric consent</span>
            <span className="muted">Gated; captured per title in a later rights wave</span>
          </li>
          <li>
            <span>Territory and licensing</span>
            <span className="muted">Gated; territories and license terms recorded per title later</span>
          </li>
          <li>
            <span>Music and third-party clearances</span>
            <span className="muted">Gated; clearance status summarized per title later</span>
          </li>
        </ul>
        <p className="muted" data-testid="team-rights-note" style={{ marginTop: 8 }}>
          This is a read-only summary scaffold. The full rights workflow, including consent capture and
          territory management, is a later wave and is not editable here.
        </p>
      </div>
    </section>
  );
}
