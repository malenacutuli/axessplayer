# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/social. Built from the REPO ROOT context (docker build -f
# services/social/Dockerfile .) so pnpm resolves the whole workspace. Node 20, pnpm via corepack,
# frozen lockfile. No em dashes.
#
# NOTE: this service is NOT added to render.yaml (not deployed, per the slice hard rules). The image builds
# and typechecks; the CMD targets the guard-free serve entry, mirroring services/identity and content. The
# package EXPORTS createSocialApp (a Hono app factory) and a node:http bridge in server.ts; the `serve`
# script binds it to PORT (default 8108) on 0.0.0.0 for container reachability.

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
RUN pnpm --filter @axessplayer/social typecheck

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8108
EXPOSE 8108
WORKDIR /app/services/social
CMD ["node", "--import", "tsx", "src/serve.ts"]
