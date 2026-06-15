# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/marketing (the marketing site). Built from the REPO ROOT context
# (docker build -f apps/marketing/Dockerfile .) so pnpm resolves the whole workspace. Node 20, pnpm via
# corepack, frozen lockfile. Primary deploy target is Vercel; this image is the portable alternative.
#
# FLAG (human cutover): the marketing app is a STUB at this cut (its scripts are echo placeholders and it
# emits no static output). This image installs the workspace and runs the placeholder build so it is ready
# the moment real content lands. Once the app produces a static bundle, switch the runtime stage to nginx
# serving that output (mirror apps/web/Dockerfile). No em dashes.

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
RUN pnpm --filter @axessplayer/marketing build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
# Placeholder. The marketing app is a stub; swap to an nginx static-serve stage once it builds a bundle.
CMD ["pnpm", "--filter", "@axessplayer/marketing", "build"]
