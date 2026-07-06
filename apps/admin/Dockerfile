FROM node:22-alpine AS admin-builder
WORKDIR /app
COPY apps/admin/package*.json ./
RUN npm install
COPY apps/admin/ .
RUN npm run build:skip-tsc

FROM node:22-alpine AS pos-builder
WORKDIR /app
COPY apps/pos/package*.json ./
RUN npm install
COPY apps/pos/ .
RUN npm run build

FROM nginx:stable-alpine AS runner
COPY --from=admin-builder /app/dist /usr/share/nginx/html/admin
COPY --from=pos-builder /app/dist /usr/share/nginx/html/pos
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]