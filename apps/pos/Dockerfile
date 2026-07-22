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

FROM nginx:stable-alpine AS runner
COPY --from=builder /app/apps/pos/dist /usr/share/nginx/html/pos
COPY apps/pos/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/pos/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
