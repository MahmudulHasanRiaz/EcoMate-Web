FROM node:22-alpine AS builder
ARG VITE_API_URL=/api
ARG VITE_BASE=/admin/
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_BASE=${VITE_BASE}
WORKDIR /app
COPY package*.json ./
COPY apps/admin/package.json apps/admin/package.json
RUN --mount=type=cache,target=/root/.npm npm install
COPY apps/admin apps/admin
WORKDIR /app/apps/admin
RUN npm run build

FROM nginx:stable-alpine AS runner
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html/admin
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
