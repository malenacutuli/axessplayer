# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/decision. Built from the REPO ROOT context (docker build -f
# services/decision/Dockerfile .) so pnpm resolves the whole workspace. Node 20, pnpm via corepack,
# frozen lockfile. No em dashes.
#
# FLAG (human cutover): the decision package currently EXPORTS a Hono app factory (createDecisionApp) but
# does not commit a standalone listener or a `serve` script. W11 must not edit service code, so the CMD
# below targets a `serve` script the decision team needs to add (a node listener that binds the exported
# app to PORT, like manifest/src/server.ts). Until then this image builds and typechecks but the CMD is a
# documented placeholder, not a runnable entrypoint.

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
# Generate typed contract clients (decision imports contracts/types/generated/*), then build the package.
RUN pnpm gen
RUN pnpm --filter @axessplayer/decision... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8080
EXPOSE 8080
# Run the guard-free serve entry directly with node (pnpm --filter ... serve does not spawn the child in
# the container; node --import tsx src/serve.ts from the package dir is the verified-working invocation).
WORKDIR /app/services/decision
CMD ["node", "--import", "tsx", "src/serve.ts"]
