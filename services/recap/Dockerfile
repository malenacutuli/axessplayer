# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/recap. Built from the REPO ROOT context (docker build -f
# services/recap/Dockerfile .) so pnpm resolves the whole workspace. Node 20, pnpm via corepack, frozen
# lockfile. Mirrors services/content/Dockerfile with WORKDIR /app/services/recap. NOT wired into render.yaml
# (do not deploy yet). No em dashes.

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
RUN pnpm --filter @axessplayer/recap typecheck

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
ENV PORT=8096
EXPOSE 8096
# Run the guard-free serve entry directly with node (the verified-working invocation from the package dir).
WORKDIR /app/services/recap
CMD ["node", "--import", "tsx", "src/serve.ts"]
