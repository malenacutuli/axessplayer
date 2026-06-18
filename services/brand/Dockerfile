# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/brand (the brand revenue-rail service, prompt 19). Built from the REPO
# ROOT context (docker build -f services/brand/Dockerfile .) so pnpm resolves the whole workspace. The
# package ships src/serve.ts (the guard-free listener), which the CMD runs directly with node + tsx (the
# verified-working invocation, mirroring economy/monetization). It binds 0.0.0.0 on PORT 8104.
#
# NOT in render.yaml: this service is not deployed. The production cutover-gate in serve.ts throws under
# NODE_ENV=production until a real advertiser/operator JWKS verifier is injected, so this image runs with a
# non-production NODE_ENV for QA only. Stripe stays TEST mode; billing posts ledger entries, never a live
# charge. No em dashes.

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
RUN pnpm --filter @axessplayer/brand typecheck

FROM base AS runtime
# staging, NOT production: the production cutover-gate (serve.ts selectVerifiers) hard-stops under
# NODE_ENV=production because real JWKS auth for advertiser/operator is not implemented. staging uses the
# test verifier scheme (advertiser:<uuid> / BRAND_OPERATOR_SECRET) for QA only.
ENV NODE_ENV=staging
COPY --from=build /app /app
ENV PORT=8104
EXPOSE 8104
WORKDIR /app/services/brand
CMD ["node", "--import", "tsx", "src/serve.ts"]
