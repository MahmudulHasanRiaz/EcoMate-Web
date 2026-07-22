FROM node:22-alpine AS builder
ARG VITE_BASE=/admin/
ENV VITE_BASE=${VITE_BASE}
WORKDIR /app
COPY package*.json ./
COPY packages/ packages/
COPY apps/admin/package.json apps/admin/package.json
RUN npm install
RUN npx tsc -p packages/shared-types/tsconfig.json
COPY apps/admin apps/admin
WORKDIR /app/apps/admin
RUN npm run build:skip-tsc

FROM node:22-alpine AS obfuscator
WORKDIR /app
RUN npm install -g javascript-obfuscator@^4.1.1
COPY --from=builder /app/apps/admin/dist ./dist
COPY apps/backend/obfuscator.config.json ./
RUN javascript-obfuscator dist/ \
    --output dist-obfuscated/ \
    --config obfuscator.config.json && \
    rm -rf dist && \
    mv dist-obfuscated dist
# Restore files that obfuscation may have corrupted (service worker, manifest)
COPY --from=builder /app/apps/admin/dist ./dist-base
RUN cp dist-base/index.html dist/index.html 2>/dev/null; \
    cp -r dist-base/sw.js dist/sw.js 2>/dev/null; \
    cp -r dist-base/workbox-*.js dist/ 2>/dev/null; \
    cp dist-base/manifest.webmanifest dist/manifest.webmanifest 2>/dev/null; \
    cp -r dist-base/images dist/ 2>/dev/null; \
    rm -rf dist-base

FROM nginx:stable-alpine AS runner
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html/admin
COPY --from=obfuscator /app/dist /usr/share/nginx/html/admin
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
