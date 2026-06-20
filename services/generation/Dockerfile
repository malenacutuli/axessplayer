# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/generation. Built from the REPO ROOT context (docker build -f
# services/generation/Dockerfile .) so pnpm resolves the whole workspace. Node 20, pnpm via corepack, frozen
# lockfile. Mirrors services/recap/Dockerfile with WORKDIR /app/services/generation. No em dashes.
#
# Prompt 26: generation now ALSO serves an HTTP API (the model-agnostic router + consistency QA + the attempt
# log) via src/serve.ts, in addition to the offline pipeline library. The container serves. Real model
# backends stay OFF unless GENERATION_REAL_BACKEND=1, and /generate refuses real spend unless
# GENERATION_ALLOW_REAL_SPEND=1 (the human cost gate); the default is the deterministic fake backend.

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
RUN pnpm --filter @axessplayer/generation typecheck

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8107
EXPOSE 8107
WORKDIR /app/services/generation
CMD ["node", "--import", "tsx", "src/serve.ts"]
