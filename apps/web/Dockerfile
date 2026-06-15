# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/web (Vite + React consumer SPA). Built from the REPO ROOT context
# (docker build -f apps/web/Dockerfile .) so pnpm resolves the whole workspace. Node 20 + pnpm build the
# static bundle; nginx serves it. The primary deploy target for this app is Vercel (see apps/web/
# vercel.json); this image is the portable, self-hosted alternative. No em dashes.
#
# NOTE: Vite inlines VITE_* env vars at BUILD time, so the runtime service URLs must be present as build
# args/env when this image is built (one image per environment), not injected at container start. The
# app falls back to a single localhost gateway when they are absent (src/config.ts). No em dashes.

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
# VITE_* values are baked here. Pass them with --build-arg per environment. Names only, never defaults
# that are secrets. See infra/ENV.md.
ARG VITE_CONTENT_BASE_URL
ARG VITE_ECONOMY_BASE_URL
ARG VITE_DECISION_BASE_URL
ARG VITE_MANIFEST_BASE_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
# Generate typed contract clients the app imports, then build the static bundle into apps/web/dist.
RUN pnpm gen
RUN pnpm --filter @axessplayer/web... build

FROM nginx:1.27-alpine AS runtime
# SPA fallback: unknown routes serve index.html so client-side routing works.
RUN printf 'server {\n  listen 8080;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
