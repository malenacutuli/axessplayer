// 20-V3 DISCOVER: channel route (route /channel/:id). The INTERACTION_MAP lists a channel detail fed by
// services/catalog by channel; that listing endpoint is not in this wave's CATALOG API CONTRACT, so the
// route exists with an explicit coming-soon empty state and a Follow control that emits its analytics
// event. This is the "no dead end" rule: the control opens its route and emits its event before the
// backend exists. No em dashes.

import { useState } from "react";
import { Button, EmptyState } from "@axessplayer/ui";
import type { ViewerAnalytics } from "../analytics/analytics.js";

export interface ChannelProps {
  channelId: string;
  analytics: ViewerAnalytics;
  onBack: () => void;
}

export function Channel({ channelId, analytics, onBack }: ChannelProps) {
  const [following, setFollowing] = useState(false);
  return (
    <div className="scr chn" data-testid="channel">
      <div className="sd__topbar">
        <button type="button" className="sd__back" onClick={onBack} aria-label="Back" data-testid="channel-back">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="sd__body">
        <EmptyState
          title="Channel coming soon"
          action={
            <Button
              variant={following ? "secondary" : "primary"}
              aria-pressed={following}
              data-testid="channel-follow"
              onClick={() => {
                setFollowing((prev) => {
                  const next = !prev;
                  if (next) analytics.track("channel_followed", { props: { channelId } });
                  return next;
                });
              }}
            >
              {following ? "Following" : "Follow"}
            </Button>
          }
        >
          The channel grid is on the way. Follow to be notified when new series land here.
        </EmptyState>
      </div>
    </div>
  );
}
