# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/experiment (holdout framework + adaptive-lift measurement). Built
# from the REPO ROOT context (docker build -f services/experiment/Dockerfile .) so pnpm resolves the whole
# workspace. Node 20, pnpm via corepack, frozen lockfile. No em dashes.
#
# FLAG (human cutover): the experiment package is a STUB at this cut (its scripts are echo placeholders,
# there is no source, listener, or `serve`). This image installs the workspace so it is ready the moment
# the package gains real code; the CMD is a documented placeholder the experiment team replaces. No
# EXPOSE, since there is no listener yet. No em dashes.

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
RUN pnpm --filter @axessplayer/experiment build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
# Placeholder. The experiment package is a stub; replace with its real entrypoint once it exists.
CMD ["pnpm", "--filter", "@axessplayer/experiment", "build"]
