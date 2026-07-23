FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/ packages/
COPY apps/backend/package.json apps/backend/package.json
RUN npm install
RUN npx tsc -p packages/shared-types/tsconfig.json && \
    npx tsc -p packages/license-engine/tsconfig.json && \
    npx tsc -p packages/feature-flags/tsconfig.json
# Dereference workspace symlinks so Docker COPY produces real directories
RUN for pkg in license-engine feature-flags shared-types; do \
      target="node_modules/@ecomate/$pkg"; \
      [ -L "$target" ] && rm -rf "$target" && mkdir -p "$target" && \
      cp "packages/$pkg/package.json" "$target/" && \
      cp -r "packages/$pkg/dist" "$target/"; \
    done
COPY apps/backend apps/backend
WORKDIR /app/apps/backend
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS obfuscator
WORKDIR /app
RUN npm install -g javascript-obfuscator@^4.1.1
COPY --from=builder /app/apps/backend/dist ./dist
COPY apps/backend/obfuscator.config.json ./
RUN javascript-obfuscator dist/ \
    --output dist-obfuscated/ \
    --config obfuscator.config.json && \
    rm -rf dist && \
    mv dist-obfuscated dist
# Restore non-JS data files lost during obfuscation
COPY --from=builder /app/apps/backend/dist ./dist-base
RUN cp -r dist-base/feed/data/ dist/feed/data/ 2>/dev/null; rm -rf dist-base

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=obfuscator /app/dist ./dist
COPY --from=builder /app/apps/backend/prisma ./prisma
COPY --from=builder /app/apps/backend/prisma.config.ts ./
COPY --from=builder /app/apps/backend/package.json ./
COPY --from=builder /app/apps/backend/public ./public
COPY apps/backend/startup.sh ./startup.sh
RUN mkdir -p /app/uploads /app/.cache /app/mobile-builds && \
    chown -R nestjs:nodejs /app/uploads /app/.cache /app/mobile-builds && \
    chmod +x startup.sh
# Copy pre-built mobile APK from build context (empty dir if CI didn't build)
COPY mobile-builds /app/mobile-builds/
USER nestjs
EXPOSE 4000
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4000/api/health || exit 1
CMD ["./startup.sh"]
