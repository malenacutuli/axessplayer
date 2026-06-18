# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/delight (the character inbox + branch-as-quest DELIGHT plane). Built
# from the REPO ROOT context so pnpm resolves the whole workspace. Mirrors services/adaptation/Dockerfile
# with WORKDIR /app/services/delight and PORT 8107.
#
# FLAG (human cutover): delight is NOT in render.yaml. It is intentionally not deployed until
# scripts/sql/13_delight.sql is applied, a real JWKS SessionVerifier + a PgDelightStore are wired, and the
# economy/decision/consent/c2pa ports point at real clients. Starting with NODE_ENV=production hard-stops on
# the test verifier (the CUTOVER GATE in httpServer.ts). No em dashes.

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
RUN pnpm --filter @axessplayer/delight typecheck

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8107
EXPOSE 8107
WORKDIR /app/services/delight
CMD ["node", "--import", "tsx", "src/serve.ts"]
