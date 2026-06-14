# Vercel Deployment : web surfaces

This document covers the three web surfaces of Axessplayer that deploy to Vercel. The native mobile app does not deploy here (see section 9). All projects live under the same Vercel team.

- Team name: malenacutulis-projects
- Team id: team_ytNVrklhg3uuLDG9sOjSas9n

## 1. Project map

Three Vercel projects, each pointing at a different root inside the pnpm + turborepo monorepo.

| Vercel project | Root Directory | Framework preset |
| --- | --- | --- |
| axessplayer-marketing | apps/marketing | Next.js |
| axessplayer-web | apps/web | Next.js |
| axessplayer-studio | apps/studio | Vite |

All three projects belong to team id team_ytNVrklhg3uuLDG9sOjSas9n. They sit alongside the existing projects in that team (axessible, axessible-frontend, and the unrelated swiss* projects). Do not reuse or rename the existing projects. Create the three new projects listed above.

## 2. Linking the monorepo

From the monorepo root, link all projects at once with a single command. The `--repo` flag tells Vercel this is a multi-project repository and links every connected project in one pass.

```bash
vercel link --repo
```

After linking, open each project in Vercel project settings and set its Root Directory:

- axessplayer-marketing : Root Directory = apps/marketing
- axessplayer-web : Root Directory = apps/web
- axessplayer-studio : Root Directory = apps/studio

Vercel infers the Turborepo filter from the Root Directory. When the Root Directory is set to an app folder, Vercel detects the workspace package at that path and runs the Turborepo build filtered to that package and its internal dependencies. You do not need to write a manual `turbo run build --filter=...` for each project. Vercel derives the filter from the root directory you set.

## 3. turbo.json build outputs

Declare build outputs in `turbo.json` so the Turborepo cache knows what to save and restore. Exclude the Next.js cache directory.

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    }
  }
}
```

Why exclude `.next/cache`: the `.next/cache` directory is a local incremental build cache that Next.js rebuilds on each run. It is large, it changes every build, and it is not a deployable artifact. If it were included in the Turborepo outputs it would bloat the remote cache, slow uploads and downloads, and produce cache entries that never match cleanly. Excluding it keeps the Turborepo remote cache small and focused on the real build output (`.next/**` minus the cache, plus `dist/**` for the Vite app).

## 4. Per-app vercel.json

Each app can carry its own `vercel.json` at its root directory. Example for a Next.js app that has API routes under `app/api`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "app/api/**/*": {
      "maxDuration": 30
    }
  },
  "relatedProjects": [
    "axessplayer-marketing",
    "axessplayer-web",
    "axessplayer-studio"
  ]
}
```

`functions.maxDuration` raises the execution ceiling for the `app/api` serverless functions. `relatedProjects` (up to three) links the projects together so that the web and studio surfaces can read the marketing and api hosts of their related projects as system environment variables at build time, without hardcoding URLs.

## 5. Environment variables

Set these per project, and set them separately for Preview and Production environments.

Per project envs:

- NEXT_PUBLIC_SUPABASE_URL : the Supabase project URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY : the Supabase anon (public) key
- DECISION_API_BASE_URL : base URL of the decision service
- ECONOMY_API_BASE_URL : base URL of the economy service
- CONTENT_API_BASE_URL : base URL of the content service
- MANIFEST_API_BASE_URL : base URL of the manifest service

Notes:

- Each variable is set once for Preview and once for Production. Preview values point at staging or preview hosts. Production values point at production hosts.
- For the Vite studio app, public values use the `VITE_` prefix instead of `NEXT_PUBLIC_`.
- Secrets are set in Vercel project settings (Environment Variables) and are never committed to the repository. Do not place real keys in `vercel.json`, in `.env` files that are checked in, or in any tracked file.

## 6. Preview deployments

- Every pull request gets its own preview URL automatically.
- The W12 end-to-end suite can run against that preview URL, so each PR is exercised against a live deployment before merge.
- Production deploys on merge to the main branch.

## 7. Domains

Assign one domain per project in Vercel project settings.

| Domain | Vercel project |
| --- | --- |
| axessplayer.com | axessplayer-marketing |
| app.axessplayer.com | axessplayer-web |
| studio.axessplayer.com | axessplayer-studio |

## 8. Using the Vercel MCP connector

The orchestrator or the W11 agent can use the Vercel MCP connector for deploy and debug tasks.

- list_projects : find the project id for axessplayer-marketing, axessplayer-web, or axessplayer-studio under team team_ytNVrklhg3uuLDG9sOjSas9n.
- deploy_to_vercel : trigger a deploy for a project.
- get_deployment : check the status of a deployment.
- get_deployment_build_logs : pull build logs to debug a failed build.
- get_runtime_logs : inspect runtime logs after a deploy.

Important: a PRODUCTION deploy is a publish action. It must be triggered or approved by a human, not auto-run by an agent. Agents may freely create and inspect preview deployments and read logs, but they must not promote to production or run a production deploy without explicit human approval.

## 9. Native mobile app

The native mobile app does not deploy to Vercel. It ships through EAS to the app stores (see DEPLOY_RUNBOOK.md).
