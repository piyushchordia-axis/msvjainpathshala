# syntax=docker/dockerfile:1.7
# Slim, multi-stage build for the Jain Pathshala API server.
# The whole server esbuild-bundles to a single dist/index.mjs; the ONLY native
# runtime dependency is `sharp` (QR rendering). Everything else (express, pg,
# drizzle, ioredis, aws-sdk, razorpay, pdf-lib …) is inlined into the bundle.
# Result: a tiny runtime image (alpine + node + the bundle + sharp).

########################## Builder ##########################
FROM node:22-alpine AS builder
ENV CI=1
# Pin the pnpm that produced pnpm-lock.yaml (9.x reads pnpm.overrides from
# package.json; pnpm 11 moved it, which breaks the frozen-lockfile check).
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

# Copy the workspace (node_modules/dist excluded via .dockerignore) and install
# only what the api-server needs (itself + its workspace deps), then bundle.
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..."
RUN pnpm --filter @workspace/api-server run build

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

# Only the externalized native module. sharp 0.34 ships prebuilt musl binaries,
# so no compiler/vips toolchain is needed.
RUN npm init -y >/dev/null 2>&1 \
 && npm install --omit=dev --no-audit --no-fund sharp@0.34.5 \
 && npm cache clean --force

# The bundle (includes the generated pino worker files).
COPY --from=builder /repo/apps/api-server/dist ./dist

# Persistent uploads dir + drop root.
RUN mkdir -p /data/uploads \
 && addgroup -S app && adduser -S app -G app \
 && chown -R app:app /repo /data
USER app

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/healthz" >/dev/null 2>&1 || exit 1

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
