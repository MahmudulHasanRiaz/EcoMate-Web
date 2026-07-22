FROM node:22-alpine AS builder
ARG VITE_BASE=/pos/
ENV VITE_BASE=${VITE_BASE}
WORKDIR /app
COPY package*.json ./
COPY apps/pos/package.json apps/pos/package.json
RUN npm install
COPY apps/pos apps/pos
WORKDIR /app/apps/pos
RUN npm run build

FROM node:22-alpine AS obfuscator
WORKDIR /app
RUN npm install -g javascript-obfuscator@^4.1.1
COPY --from=builder /app/apps/pos/dist ./dist
COPY apps/backend/obfuscator.config.json ./
RUN javascript-obfuscator dist/ \
    --output dist-obfuscated/ \
    --config obfuscator.config.json && \
    rm -rf dist && \
    mv dist-obfuscated dist
# Restore non-JS files (index.html, CSS, images) that obfuscator passes through unchanged
COPY --from=builder /app/apps/pos/dist ./dist-base
RUN cp dist-base/index.html dist/index.html 2>/dev/null; rm -rf dist-base

FROM nginx:stable-alpine AS runner
COPY --from=builder /app/apps/pos/dist /usr/share/nginx/html/pos
COPY --from=obfuscator /app/dist /usr/share/nginx/html/pos
COPY apps/pos/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/pos/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
