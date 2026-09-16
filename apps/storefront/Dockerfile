FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY apps/storefront/package.json apps/storefront/package.json
RUN --mount=type=cache,target=/root/.npm npm install
COPY apps/storefront apps/storefront
WORKDIR /app/apps/storefront
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/storefront/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/storefront/.next/standalone/apps/storefront/public ./apps/storefront/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/storefront/.next/standalone/apps/storefront/.next/static ./apps/storefront/.next/static
COPY --chown=nextjs:nodejs apps/storefront/startup.sh ./startup.sh
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/robots.txt || exit 1
CMD ["sh", "startup.sh"]
