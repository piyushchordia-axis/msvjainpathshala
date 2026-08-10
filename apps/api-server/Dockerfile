# syntax=docker/dockerfile:1.7
# Slim, multi-stage build for the Jain Pathshala API server.
# The whole server esbuild-bundles to a single dist/index.mjs. Native / heavy
# packages listed in build.mjs `external` that the bundle actually imports must
# be installed here (sharp, argon2, @aws-sdk/*). Everything else is inlined.
# Result: a tiny runtime image (alpine + node + the bundle + externals).

########################## Builder ##########################
FROM node:22-alpine AS builder
ENV CI=1
# Pin the pnpm that produced pnpm-lock.yaml (9.x reads pnpm.overrides from
# package.json; pnpm 11 moved it, which breaks the frozen-lockfile check).
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

# Copy the workspace (node_modules/dist excluded via .dockerignore) and install
# what the api-server AND the admin web SPA need (each + their workspace deps),
# then bundle the API and build the web app.
COPY . .
RUN pnpm install --frozen-lockfile \
      --filter "@workspace/api-server..." \
      --filter "@workspace/jain-pathshala..."
RUN pnpm --filter @workspace/api-server run build
# Admin web SPA → served by the API at /admin (same origin). base=/admin/ so
# assets resolve there; PORT is only required by vite.config at load time.
RUN BASE_PATH=/admin/ PORT=3000 NODE_ENV=production \
      pnpm --filter @workspace/jain-pathshala run build

########################## Runtime ##########################
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    HOST=127.0.0.1 \
    PORT=8080 \
    UPLOADS_DIR=/data/uploads
# Run from the SAME absolute path the bundle was built at (/repo/apps/api-server
# in the builder). esbuild-plugin-pino bakes build-time absolute paths to its
# worker files (thread-stream-worker.mjs, pino-pretty.mjs, …) into the bundle;
# if the runtime dir differs, pino's transport worker can't be found and the
# logger crashes (only triggered when a transport is active, e.g. pino-pretty
# under NODE_ENV=development). Keeping the path identical makes that resolve.
WORKDIR /repo/apps/api-server

# Externalized runtime deps (versions pinned to pnpm-lock.yaml). sharp 0.34
# and argon2 ship prebuilt musl binaries, so no compiler toolchain is needed.
# CI smoke (scripts/smoke-externals.mjs) imports every externalized module the
# bundle references — keep this list in sync when build.mjs externals change.
RUN npm init -y >/dev/null 2>&1 \
 && npm install --omit=dev --no-audit --no-fund \
      sharp@0.34.5 \
      argon2@0.45.1 \
      @aws-sdk/client-s3@3.1068.0 \
      @aws-sdk/s3-request-presigner@3.1068.0 \
      @opentelemetry/api@1.9.1 \
 && npm cache clean --force

# The bundle (includes the generated pino worker files).
COPY --from=builder /repo/apps/api-server/dist ./dist
# The admin web SPA build (static assets only; no node_modules at runtime).
COPY --from=builder /repo/apps/jain-pathshala/dist/public ./admin-web

# Persistent uploads dir + drop root.
RUN mkdir -p /data/uploads \
 && addgroup -S app && adduser -S app -G app \
 && chown -R app:app /repo /data
USER app

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/healthz" >/dev/null 2>&1 || exit 1

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
