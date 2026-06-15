# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/trust (provenance + consent ledger). Built from the REPO ROOT context
# (docker build -f services/trust/Dockerfile .) so pnpm resolves the whole workspace. Node 20, pnpm via
# corepack, frozen lockfile. No em dashes.
#
# FLAG (human cutover): trust is currently a LIBRARY surface (it exports TrustService and adapters, with
# no committed HTTP listener or `serve` script). The trust layer is load-bearing and W11 must not edit it,
# so the CMD targets a `serve` script the trust team needs to add. The build stage runs the package's real
# `build` script. No em dashes.

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
RUN pnpm --filter @axessplayer/trust... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8080
EXPOSE 8080
# Placeholder entrypoint. See the FLAG at the top: requires a `serve` script on @axessplayer/trust.
CMD ["pnpm", "--filter", "@axessplayer/trust", "serve"]
