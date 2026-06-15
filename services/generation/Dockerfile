# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/generation (the offline Tier A/B/C pipeline + C2PA stamping). Built
# from the REPO ROOT context (docker build -f services/generation/Dockerfile .) so pnpm resolves the whole
# workspace. Node 20, pnpm via corepack, frozen lockfile. No em dashes.
#
# FLAG (human cutover): generation is an OFFLINE batch pipeline, not a long-running HTTP service. It
# exposes a library surface plus a `dryrun` harness, no `serve`. This image is meant to run as a job (a
# pipeline invocation), not a server. The CMD runs the dryrun harness as a safe default; the generation
# team wires the real batch entrypoint and its arguments. No EXPOSE, since it does not listen. No em dashes.

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
RUN pnpm --filter @axessplayer/generation... build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
# Offline job, no listener. Default to the dryrun harness. See the FLAG at the top.
CMD ["pnpm", "--filter", "@axessplayer/generation", "dryrun"]
