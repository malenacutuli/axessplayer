// Create profile screen (20-V0, INTERACTION_MAP "Create profile, channel picks"). Shown after a first
// sign in when the profile is incomplete. Three parts:
//   1. Avatar upload to Supabase storage (the "avatars" bucket), optional; the public URL is sent as
//      avatar_url to POST /profile.
//   2. @username with LIVE availability via GET /profile/username-available, debounced as the viewer types.
//   3. "What do you love?" pick 3 or more channel/trope chips; each becomes a channel_follow.
// On submit, POST /profile with the Supabase access token as bearer (F1: no user_id in the body). All
// states (idle/checking/available/taken/invalid, uploading, submitting, error) are rendered. WCAG AA. No
// em dashes.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Chip, Wordmark } from "@axessplayer/ui";
import { getSupabase } from "./supabaseClient.js";
import { IdentityError, type IdentityClient, type UsernameReason } from "./identityApi.js";
import type { AuthAnalytics } from "./authAnalytics.js";
import { MIN_PICKS, PICK_CATALOG } from "./picksCatalog.js";

type AvailState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "invalid"; reason: UsernameReason }
  | { kind: "taken" }
  | { kind: "error" };

export interface CreateProfileProps {
  identity: IdentityClient;
  accessToken: string;
  analytics: AuthAnalytics;
  // Notifies the host once the profile is created so it can advance to the app.
  onCreated: (user: import("./identityApi.js").IdentityUser, complete: boolean) => void;
  // Optional series id used to key the seeded preference vector.
  seriesId?: string;
}

const REASON_TEXT: Record<UsernameReason, string> = {
  empty: "Pick a username.",
  too_short: "At least 3 characters.",
  too_long: "At most 30 characters.",
  invalid_chars: "Use letters, numbers, and underscores only.",
};

export function CreateProfile({
  identity,
  accessToken,
  analytics,
  onCreated,
  seriesId,
}: CreateProfileProps): JSX.Element {
  const [username, setUsername] = useState("");
  const [avail, setAvail] = useState<AvailState>({ kind: "idle" });
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    analytics.breadcrumb({ step: "profile_create_shown" });
  }, [analytics]);

  // Debounced live availability check. Each keystroke cancels the prior timer; a monotonically increasing
  // request id ignores out-of-order responses so a stale check never overwrites a fresher one.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const value = username.trim();
    if (value.length === 0) {
      setAvail({ kind: "idle" });
      return;
    }
    setAvail({ kind: "checking" });
    const myReq = ++reqIdRef.current;
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await identity.usernameAvailable(value);
          if (myReq !== reqIdRef.current) return;
          if (res.available) setAvail({ kind: "available" });
          else if (res.reason) setAvail({ kind: "invalid", reason: res.reason });
          else setAvail({ kind: "taken" });
        } catch {
          if (myReq !== reqIdRef.current) return;
          setAvail({ kind: "error" });
        }
      })();
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [username, identity]);

  const togglePick = useCallback((id: string) => {
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const supabase = getSupabase();
    if (!supabase) return;
    setUploading(true);
    setSubmitError(null);
    try {
      const ext = file.name.split(".").pop() ?? "png";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
      if (upErr) {
        setSubmitError("We could not upload that image. You can add one later.");
        return;
      }
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
    } catch {
      setSubmitError("We could not upload that image. You can add one later.");
    } finally {
      setUploading(false);
    }
  }, []);

  const canSubmit = avail.kind === "available" && picks.size >= MIN_PICKS && !submitting && !uploading;

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      setSubmitting(true);
      setSubmitError(null);
      const pickList = Array.from(picks).map((channelId) => ({ channelId }));
      try {
        const res = await identity.createProfile(accessToken, {
          username: username.trim(),
          avatar_url: avatarUrl,
          picks: pickList,
          series_id: seriesId,
        });
        // Each pick is a canonical channel_followed event.
        for (const p of pickList) analytics.channelFollowed(p.channelId);
        analytics.breadcrumb({ step: "profile_created" });
        onCreated(res.user, res.profile_complete);
      } catch (err) {
        if (err instanceof IdentityError && err.code === "username_taken") {
          setAvail({ kind: "taken" });
          setSubmitError("That username was just taken. Try another.");
        } else if (err instanceof IdentityError && err.status === 0) {
          setSubmitError("Profiles are not ready in this environment yet. Please try again later.");
        } else {
          setSubmitError("We could not create your profile. Please try again.");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, picks, identity, accessToken, username, avatarUrl, seriesId, analytics, onCreated],
  );

  return (
    <form className="auth-scr" data-testid="create-profile" onSubmit={submit} noValidate>
      <div className="auth-head">
        <Wordmark />
        <h1 className="auth-title">Create your profile</h1>
        <p className="auth-sub">A handle, a face if you like, and a few things you love. You can change these later.</p>
      </div>

      <div className="auth-avatar-row">
        <img
          className="auth-avatar"
          src={avatarUrl ?? "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>"}
          alt={avatarUrl ? "Your chosen avatar" : "No avatar chosen yet"}
        />
        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-avatar">
            Avatar (optional)
          </label>
          <input
            id="auth-avatar"
            className="auth-input"
            type="file"
            accept="image/*"
            onChange={(e) => void onAvatarChange(e)}
            disabled={uploading}
          />
          <p className="auth-hint" role="status" aria-live="polite">
            {uploading ? "Uploading." : avatarUrl ? "Avatar ready." : ""}
          </p>
        </div>
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor="auth-username">
          Username
        </label>
        <input
          id="auth-username"
          className="auth-input"
          type="text"
          autoComplete="username"
          inputMode="text"
          maxLength={30}
          required
          aria-invalid={avail.kind === "invalid" || avail.kind === "taken"}
          aria-describedby="auth-username-hint"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <p
          id="auth-username-hint"
          className={
            "auth-hint" +
            (avail.kind === "available" ? " auth-hint--ok" : "") +
            (avail.kind === "invalid" || avail.kind === "taken" || avail.kind === "error" ? " auth-hint--error" : "")
          }
          role="status"
          aria-live="polite"
        >
          {usernameHint(avail)}
        </p>
      </div>

      <fieldset className="auth-field" style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="auth-label">What do you love? Pick {MIN_PICKS} or more.</legend>
        <div className="auth-pickgrid" role="group" aria-label="Channels and tropes">
          {PICK_CATALOG.map((opt) => (
            <Chip
              key={opt.id}
              active={picks.has(opt.id)}
              className="auth-pick"
              onClick={() => togglePick(opt.id)}
            >
              {opt.label}
            </Chip>
          ))}
        </div>
        <p className="auth-hint" role="status" aria-live="polite">
          {picks.size < MIN_PICKS ? `${MIN_PICKS - picks.size} more to go.` : `${picks.size} selected.`}
        </p>
      </fieldset>

      <p className="auth-hint auth-hint--error" role="alert" aria-live="assertive">
        {submitError ?? ""}
      </p>

      <div className="auth-actions">
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? "Creating." : "Enter Axessplayer"}
        </Button>
      </div>
    </form>
  );
}

function usernameHint(avail: AvailState): string {
  switch (avail.kind) {
    case "idle":
      return "Letters, numbers, and underscores. 3 to 30 characters.";
    case "checking":
      return "Checking availability.";
    case "available":
      return "Available.";
    case "taken":
      return "That username is taken.";
    case "invalid":
      return REASON_TEXT[avail.reason];
    case "error":
      return "We could not check that right now.";
  }
}
