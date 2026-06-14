# Deploy Runbook : web and native

This runbook covers two deploy targets. The three web surfaces ship to Vercel. The native mobile app ships through Expo Application Services (EAS). They are separate pipelines with separate tooling.

Grounding constants used below:

- Vercel team: `malenacutulis-projects`, id `team_ytNVrklhg3uuLDG9sOjSas9n`.
- Vercel projects: `axessplayer-marketing`, `axessplayer-web`, `axessplayer-studio`.
- Monorepo: pnpm workspaces plus turborepo.

---

## Section A. Web (Vercel)

The marketing site, the web consumer app, and the creator studio are three separate Vercel projects backed by one monorepo.

### A.1 One-time link and project setup

1. From the monorepo root, link the repo to the Vercel team:

   ```bash
   vercel link --repo
   ```

   When prompted, select the team `malenacutulis-projects` (id `team_ytNVrklhg3uuLDG9sOjSas9n`).

2. For each of the three projects, set the Root Directory and framework preset. Do this in Vercel project settings under General, then Root Directory.

   - `axessplayer-marketing`: Root Directory `apps/marketing`.
   - `axessplayer-web`: Root Directory `apps/web`.
   - `axessplayer-studio`: Root Directory `apps/studio`.

   Set the framework preset on each project to match the app framework so Vercel applies the correct build and output defaults.

### A.2 Connect Git for automatic deployments

1. Connect the Git repository to each Vercel project so pushes create deployments.
2. Pull requests create Preview deployments.
3. Merges to `main` create Production deployments.

### A.3 Environment variables

1. Set environment variables per project in Vercel project settings under Environment Variables.
2. Scope each variable to the correct environment: Preview, Production, or both.
3. Keep Preview and Production values distinct where the target differs, for example API base URLs and analytics keys.

### A.4 Custom domains

Attach custom domains in Vercel project settings under Domains:

- `axessplayer.com` to `axessplayer-marketing`.
- `app.axessplayer.com` to `axessplayer-web`.
- `studio.axessplayer.com` to `axessplayer-studio`.

### A.5 Agent-driven deploy via the Vercel MCP connector

1. Call `list_projects` to resolve the project id you intend to deploy.
2. Call `deploy_to_vercel` to trigger a deployment.
3. On failure, call `get_deployment_build_logs` to read the build output and debug.

Guardrail: a Production deploy is a publish action that a human must approve or trigger. Agents prepare config and run preview deploys only. Agents do not push to Production without explicit human approval.

---

## Section B. Native app (EAS, not Vercel)

The React Native plus Expo app does not deploy to Vercel. It builds and submits through EAS.

### B.1 Configure build profiles

1. Configure `eas.json` with build profiles: `development`, `preview`, and `production`.
2. Set environment variables per profile in `eas.json` and in the EAS project settings.

### B.2 Build

Build per platform:

```bash
eas build --platform ios
eas build --platform android
```

### B.3 Submit

Submit the built binaries to the stores:

```bash
eas submit --platform ios
eas submit --platform android
```

The iOS submission targets App Store Connect. The Android submission targets Google Play.

### B.4 Over-the-air updates

1. For JS-only changes, publish an over-the-air update with Expo Updates:

   ```bash
   eas update
   ```

2. Native changes, for example new native modules or changes to native config, require a new store build. They cannot ship as an over-the-air update.

### B.5 Human approval

Store submissions and release to production are human-approved actions. Agents do not submit or release to the stores without explicit human approval.

---

## Section C. CI wiring

1. GitHub Actions runs turbo build, typecheck, and tests on every pull request.
2. Vercel auto-builds the three web projects on push: Preview on a pull request, Production on `main`.
3. EAS builds the native app on a version tag.
4. The W12 end-to-end suite runs against Vercel Preview URLs for the web app.

---

## Section D. Ownership

- W11 owns the Vercel projects, the EAS pipeline, environment management, and CI.
- W6 owns the native build config (`eas.json`).
- W6w owns the web build config (`apps/web`).
- W7 owns `apps/studio`.
- The marketing site config is owned by whoever owns `apps/marketing`. Assign to W11 for now.
