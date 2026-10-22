FROM node:24.22.1-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY apps/storefront/package.json apps/storefront/package.json
RUN --mount=type=cache,target=/root/.npm npm install
COPY apps/storefront apps/storefront
WORKDIR /app/apps/storefront
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24.22.1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Bind all interfaces: Docker auto-sets HOSTNAME to the container ID (which
# resolves to the container IP, e.g. 172.26.0.5), so without this the
# standalone server listens on the container IP ONLY and the
# localhost:3000 healthcheck gets connection refused (false unhealthy).
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
# Standalone output: apps/storefront/server.js + node_modules/ at root
COPY --from=builder --chown=nextjs:nodejs /app/apps/storefront/.next/standalone ./
# Public and static assets go next to server.js (monorepo path)
COPY --from=builder --chown=nextjs:nodejs /app/apps/storefront/public ./apps/storefront/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/storefront/.next/static ./apps/storefront/.next/static
COPY --chown=nextjs:nodejs apps/storefront/startup.sh ./apps/storefront/startup.sh
USER nextjs
EXPOSE 3000
# NOTE: the probe uses 127.0.0.1, NOT localhost — BusyBox wget resolves
# localhost to ::1 first with no fallback, and the server is IPv4-only.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1
CMD ["sh", "apps/storefront/startup.sh"]
