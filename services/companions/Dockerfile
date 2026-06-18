# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/companions. Built from the REPO ROOT context so pnpm resolves the whole
# workspace. Mirrors services/identity-performance/Dockerfile with WORKDIR /app/services/companions.
# NOT deployed: this service is intentionally absent from render.yaml (BUILT, NOT LIVE, highest wellbeing
# risk, founder-gated). No em dashes.

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
RUN pnpm --filter @axessplayer/companions typecheck

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8109
EXPOSE 8109
WORKDIR /app/services/companions
CMD ["node", "--import", "tsx", "src/serve.ts"]
