# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/events (the analytics event collector). Built from the REPO ROOT context
# so pnpm resolves the whole workspace. Mirrors services/recap/Dockerfile with WORKDIR /app/services/events.
# No em dashes.

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
RUN pnpm --filter @axessplayer/events typecheck

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8098
EXPOSE 8098
WORKDIR /app/services/events
CMD ["node", "--import", "tsx", "src/serve.ts"]
