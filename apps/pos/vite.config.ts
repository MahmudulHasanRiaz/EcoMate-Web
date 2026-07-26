import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBase = env.VITE_API_URL || process.env.VITE_API_URL || "/api";

  return {
    // The production nginx image serves this application exclusively at
    // /pos/. Keeping one supported base prevents builds whose asset and
    // service-worker URLs cannot be served by that nginx configuration.
    base: "/pos/",
    server: {
      host: "0.0.0.0",
      port: 5174,
      proxy: {
        "/api": {
          target: "http://localhost:4000",
          changeOrigin: true,
        },
        "/uploads": {
          target: "http://localhost:4000",
          changeOrigin: true,
        },
      },
    },
    plugins: [
      {
        name: "pos-api-base-html",
        transformIndexHtml(html) {
          const withApi = html.replaceAll("__POS_API_BASE__", JSON.stringify(apiBase));
          // Vite strips data-cfasync from the script tag it injects, so add
          // it back here. This prevents Cloudflare Rocket Loader from breaking
          // the module script execution.
          return withApi.replace(
            '<script type="module" crossorigin src=',
            '<script type="module" data-cfasync="false" crossorigin src=',
          );
        },
      },
      react(),
      tailwindcss(),
      VitePWA({
        registerType: "autoUpdate",
        // Registration is performed in main.tsx only after the public license
        // status has explicitly granted mobile distribution.
        injectRegister: false,
        // Branding/license-aware manifest is served by the backend through the
        // same-origin /api proxy. Do not inject a second static manifest.
        manifest: false,
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                request.destination === "image" ||
                url.pathname.endsWith("/images/resize"),
              handler: "NetworkFirst",
              options: {
                cacheName: "pos-image-cache-v1",
                cacheableResponse: { statuses: [0, 200] },
                expiration: {
                  maxEntries: 500,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                networkTimeoutSeconds: 5,
              },
            },
            {
              urlPattern: /^https?:\/\/.*\/api\/.*/i,
              handler: "NetworkFirst",
              options: {
                cacheName: "pos-api-cache-v1",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24,
                },
                networkTimeoutSeconds: 5,
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
