# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/admin-api. NOT deployed and NOT in render.yaml (slice B is a new,
# undeployed service). Built from the REPO ROOT context (docker build -f services/admin-api/Dockerfile .)
# so pnpm resolves the whole workspace. Node 20, pnpm via corepack, frozen lockfile. Mirrors the decision
# and content service images. No em dashes.

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
RUN pnpm --filter @axessplayer/admin-api... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8102
EXPOSE 8102
# Run the guard-free serve entry directly with node, the verified-working invocation in this monorepo.
# NOTE: under NODE_ENV=production the server refuses to start the TEST operator verifier (cutover gate);
# a real MFA/JWKS-backed OperatorVerifier must be injected before this image can serve in production.
WORKDIR /app/services/admin-api
CMD ["node", "--import", "tsx", "src/serve.ts"]
