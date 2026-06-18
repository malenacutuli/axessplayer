# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/adaptation (the AI live-action adaptation DAG + API). Built from the
# REPO ROOT context so pnpm resolves the whole workspace. Mirrors services/ingestion/Dockerfile with
# WORKDIR /app/services/adaptation and PORT 8105.
#
# FLAG (human cutover): adaptation is NOT in render.yaml. It is intentionally not deployed until
# scripts/sql/11_adaptation.sql is applied, a real JWKS SessionVerifier + a PgAdaptationStore + real
# probe/render backends are wired, and the consent ledger client replaces the stub. Starting with
# NODE_ENV=production hard-stops on the test verifier (the CUTOVER GATE in httpServer.ts). No em dashes.

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
RUN pnpm --filter @axessplayer/adaptation typecheck

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8105
EXPOSE 8105
WORKDIR /app/services/adaptation
CMD ["node", "--import", "tsx", "src/serve.ts"]
