# syntax=docker/dockerfile:1
# CI/build image for @axessplayer/mobile (React Native + Expo consumer app). Built from the REPO ROOT
# context (docker build -f apps/mobile/Dockerfile .) so pnpm resolves the whole workspace. Node 20, pnpm
# via corepack, frozen lockfile.
#
# IMPORTANT: the mobile app is NATIVE. It does NOT deploy as a container. It ships to the app stores
# through Expo Application Services (EAS), see DEPLOY_RUNBOOK.md section B. There is no runtime server
# image for a phone app. This Dockerfile exists only as a reproducible CI/build environment that runs the
# package's typecheck and tests (the logic/data/contract layers); native rendering is verified on device.
# Do not deploy this image as a service. No em dashes.

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

FROM deps AS ci
# Generate contract types the mobile app imports, then typecheck. This stage is the build/CI target; there
# is no runtime stage because the app does not run as a container.
RUN pnpm gen
RUN pnpm --filter @axessplayer/mobile typecheck
CMD ["pnpm", "--filter", "@axessplayer/mobile", "test"]
