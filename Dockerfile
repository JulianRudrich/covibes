# syntax=docker/dockerfile:1
# Covibes in one image: server, web app and database setup (spec 02b).
# Start it with deploy/compose.yaml, see deploy/README.md.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first, so dependencies are only installed again when they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @covibes/web build \
  && pnpm --filter @covibes/server build \
  && pnpm --filter @covibes/server deploy --prod /out

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST_DIR=/app/web \
    MIGRATIONS_DIR=/app/migrations \
    FILES_DIR=/data/files
WORKDIR /app
# Owned by root and only readable for the app, which runs as the unprivileged user `node`.
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /repo/apps/web/dist ./web
COPY --from=build /repo/packages/db/migrations ./migrations
# Uploaded files (spec 20a); mount a volume here that the app and the worker share.
RUN mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/index.js"]
