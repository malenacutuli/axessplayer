# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/content. Built from the REPO ROOT context (docker build -f
# services/content/Dockerfile .) so pnpm resolves the whole workspace. Node 20, pnpm via corepack,
# frozen lockfile. No em dashes.
#
# FLAG (human cutover): the content package EXPORTS a Hono app factory (createContentApp) but commits no
# standalone listener or `serve` script. W11 must not edit service code, so the CMD targets a `serve`
# script the content team needs to add (bind the exported app to PORT). The package has no `build` script,
# so the build stage runs `typecheck` to validate the sources compile. No em dashes.

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
# Generate typed contract clients before typecheck (workspace deps may import the generated types).
RUN pnpm gen
RUN pnpm --filter @axessplayer/content typecheck

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8080
EXPOSE 8080
# Run the guard-free serve entry directly with node (pnpm --filter ... serve does not spawn the child in
# the container; node --import tsx src/serve.ts from the package dir is the verified-working invocation).
WORKDIR /app/services/content
CMD ["node", "--import", "tsx", "src/serve.ts"]
