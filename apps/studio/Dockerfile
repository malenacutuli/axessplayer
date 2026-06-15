# syntax=docker/dockerfile:1
# Multi-stage image for @axessplayer/studio (Vite + React creator studio + admin). Built from the REPO
# ROOT context (docker build -f apps/studio/Dockerfile .) so pnpm resolves the whole workspace. Node 20 +
# pnpm build the static bundle; nginx serves it. Primary deploy target is Vercel (apps/studio/vercel.json);
# this image is the portable, self-hosted alternative. No em dashes.
#
# NOTE: Vite inlines VITE_* env vars at BUILD time, so build one image per environment. studio's build
# also typechecks against the generated content contract types, so `pnpm gen` runs first. No em dashes.

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
ARG VITE_CONTENT_BASE_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
# studio resolves generated content types via a vite alias, so generate them before the build/typecheck.
RUN pnpm gen
RUN pnpm --filter @axessplayer/studio... build

FROM nginx:1.27-alpine AS runtime
RUN printf 'server {\n  listen 8080;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/studio/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
