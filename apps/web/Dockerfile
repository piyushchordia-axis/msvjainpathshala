# apps/web/Dockerfile — Next.js 15 production server (port 3001).
#
# Uses Next's standalone output (next.config.ts `output: 'standalone'`) to
# bundle only the files actually needed for the prod server. Build context
# is the monorepo root.

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jp/web build

FROM node:20-alpine AS runner
RUN apk add --no-cache wget dumb-init && \
    addgroup -S -g 1001 appuser && \
    adduser  -S -u 1001 -G appuser appuser
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# Standalone bundle: server.js + .next/standalone + .next/static + public.
COPY --from=builder --chown=appuser:appuser /app/apps/web/.next/standalone ./
COPY --from=builder --chown=appuser:appuser /app/apps/web/.next/static     ./apps/web/.next/static
COPY --from=builder --chown=appuser:appuser /app/apps/web/public           ./apps/web/public

USER 1001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:3001/api/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
