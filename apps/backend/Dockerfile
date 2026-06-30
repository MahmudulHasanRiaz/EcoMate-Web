FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/ packages/
RUN npm install
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

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
COPY --from=builder /app/node_modules ./node_modules
COPY --from=obfuscator /app/dist ./dist
COPY --from=builder /app/apps/backend/prisma ./prisma
COPY --from=builder /app/apps/backend/package.json ./
COPY --from=builder /app/apps/backend/public ./public
RUN mkdir -p /app/uploads && chown -R nestjs:nodejs /app/uploads
USER nestjs
EXPOSE 4000
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1
CMD ["node", "dist/src/main"]
