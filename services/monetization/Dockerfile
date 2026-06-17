# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/monetization (the grant-settlement + paywall-bandit service). Built
# from the REPO ROOT context (docker build -f services/monetization/Dockerfile .) so pnpm resolves the whole
# workspace. The package exports createSettlementServer and ships src/serve.ts (the guard-free listener),
# which the CMD runs directly with node + tsx (the verified-working invocation). It calls the economy /grant
# service-to-service and the content service for the paywall propensity log; both base URLs come from env on
# Render. Stripe stays TEST mode. No em dashes.

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
RUN pnpm --filter @axessplayer/monetization typecheck

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8080
EXPOSE 8080
WORKDIR /app/services/monetization
CMD ["node", "--import", "tsx", "src/serve.ts"]
