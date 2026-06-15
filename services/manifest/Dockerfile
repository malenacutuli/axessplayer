# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/manifest. Built from the REPO ROOT context (docker build -f
# services/manifest/Dockerfile .) so pnpm can resolve the whole workspace. Node 20 (matches .nvmrc),
# pnpm via corepack, frozen lockfile. The manifest service ships a real listener (src/server.ts) wired to
# the `serve` script, so this image runs out of the box. No em dashes.

# ---- base: pinned node + pnpm ----
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# ---- deps: install the full workspace once, cached on manifest changes ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
# Copy every workspace manifest so pnpm can build the dependency graph before sources change. The broad
# glob is filtered by .dockerignore. Sources are layered in the build stage to keep this layer cacheable.
COPY apps ./apps
COPY services ./services
COPY packages ./packages
COPY contracts ./contracts
COPY tests ./tests
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

# ---- build: typecheck/compile this package and its workspace deps ----
FROM deps AS build
RUN pnpm --filter @axessplayer/manifest... build

# ---- runtime: minimal image that runs the service ----
FROM base AS runtime
ENV NODE_ENV=production
# Bring the installed workspace and built sources over from the build stage.
COPY --from=build /app /app
# The manifest listener reads PORT (src/server.ts: Number(process.env.PORT ?? 8787)). Default to 8787.
ENV PORT=8787
EXPOSE 8787
# tsx runs the TypeScript server directly; the `serve` script is the package's documented entrypoint.
CMD ["pnpm", "--filter", "@axessplayer/manifest", "serve"]
