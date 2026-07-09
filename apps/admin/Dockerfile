FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/ packages/
COPY apps/admin/package.json apps/admin/package.json
RUN npm install
RUN npx tsc -p packages/shared-types/tsconfig.json
COPY apps/admin apps/admin
WORKDIR /app/apps/admin
RUN npm run build:skip-tsc

FROM nginx:stable-alpine AS runner
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html/admin
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
