# syntax=docker/dockerfile:1.7
# Node 22.23.5, o mesmo pin do CI (actions/setup-node node-version: 22.23.5).
# O digest trava node:22-bookworm-slim. Não é Node 24.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/ui/package.json packages/ui/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/payments/package.json packages/payments/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG APP_VERSION=0.0.0
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV APP_VERSION=$APP_VERSION
ENV GIT_COMMIT=$GIT_COMMIT
ENV BUILD_TIME=$BUILD_TIME
COPY . .
RUN pnpm --filter web build

FROM base AS migrate
COPY supabase/ /repo/supabase/
COPY scripts/apply-superuser-grants.sh /usr/local/bin/apply-superuser-grants
USER node
# A CLI entra no job de migration (M2/M3). Esta etapa só carrega as migrations.
CMD ["echo", "migrations em /repo/supabase"]

FROM ${NODE_IMAGE} AS production
ARG APP_VERSION=0.0.0
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV APP_VERSION=$APP_VERSION
ENV GIT_COMMIT=$GIT_COMMIT
ENV BUILD_TIME=$BUILD_TIME
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /repo/apps/web/absolute-form.cjs ./apps/web/absolute-form.cjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "-r", "./apps/web/absolute-form.cjs", "apps/web/server.js"]
