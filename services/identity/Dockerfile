# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/identity. Built from the REPO ROOT context (docker build -f
# services/identity/Dockerfile .) so pnpm resolves the whole workspace. Node 20, pnpm via corepack,
# frozen lockfile. No em dashes.
#
# NOTE: this service is NOT added to render.yaml in this wave (not deployed). The image builds and
# typechecks; the CMD targets the guard-free serve entry, mirroring services/content and services/decision.
# The package EXPORTS createIdentityApp (a Hono app factory) and a node:http bridge in server.ts; the
# `serve` script binds it to PORT (default 8097) on 0.0.0.0 for container reachability.

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY services ./services
COPY packages ./packages
COPY contracts ./contracts
COPY tests ./tests
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm gen
RUN pnpm --filter @axessplayer/identity typecheck

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8097
EXPOSE 8097
# Run the guard-free serve entry directly with node (pnpm --filter ... serve does not spawn the child in
# the container; node --import tsx src/serve.ts from the package dir is the verified-working invocation).
WORKDIR /app/services/identity
CMD ["node", "--import", "tsx", "src/serve.ts"]
