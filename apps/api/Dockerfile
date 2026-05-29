# apps/api/Dockerfile — NestJS HTTP server (port 3000).
#
# Multi-stage:
#   builder — installs all deps + builds dist/.
#   runner  — node:20-alpine with only production deps, non-root user,
#             dumb-init for proper signal handling.
#
# Build context is the monorepo root (see deploy-staging.yml: `docker build -f apps/api/Dockerfile .`).

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jp/api build

FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init tini wget && \
    addgroup -S -g 1001 appuser && \
    adduser  -S -u 1001 -G appuser appuser
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy the API workspace (built output + production-pruned node_modules).
COPY --from=builder --chown=appuser:appuser /app/apps/api/dist          ./apps/api/dist
COPY --from=builder --chown=appuser:appuser /app/apps/api/package.json  ./apps/api/package.json
COPY --from=builder --chown=appuser:appuser /app/packages               ./packages
COPY --from=builder --chown=appuser:appuser /app/node_modules           ./node_modules

USER 1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:3000/healthz || exit 1
WORKDIR /app/apps/api
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
