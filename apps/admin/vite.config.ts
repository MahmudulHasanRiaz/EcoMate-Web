/// <reference types="vitest/config" />
import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { playwright } from '@vitest/browser-playwright'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Dev-only allowed hosts. Production serves the built assets via nginx, so
  // this list must never reach a deployed environment: read it from an env var
  // that only exists on the local machine (apps/admin/.env.development.local).
  const devAllowedHosts = (env.VITE_DEV_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  return {
    base: process.env.VITE_BASE || '/admin/',
    server: {
      host: '0.0.0.0',
      ...(devAllowedHosts.length > 0 ? { allowedHosts: devAllowedHosts } : {}),
      proxy: {
        '/pos': {
          target: 'http://localhost:5174',
          changeOrigin: true,
          ws: true,
        },
        '/uploads': 'http://localhost:4000',
        '/assets': 'http://localhost:4000',
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        // No manifest: the admin must not be installable (license gate), but
        // the service worker stays registered to precache app-shell assets —
        // full page reloads then load instantly from the SW cache.
        manifest: false,
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          runtimeCaching: [
            {
              // API GETs must never serve stale sw-cache (one browser showed
              // 24h-old empty product/SKU search results while others saw fresh
              // data). NetworkOnly: every request hits the backend.
              urlPattern: /^https?:\/\/.*\/api\/.*/i,
              handler: 'NetworkOnly',
              options: {
                cacheName: 'api-cache',
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    build: {
      commonjsOptions: {
        include: [/@ecomate\/shared-types/, /node_modules/],
      },
    },
    optimizeDeps: {
      include: ['@ecomate/shared-types'],
    },
    test: {
      silent: 'passed-only',
      unstubEnvs: true,
      exclude: ['src/__tests__/route-integration.test.ts'],
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
      },
      coverage: {
        // include: ['src/**/*.{js,jsx,ts,tsx}'], // Uncomment to expand the report to all src/**/* so untested modules appear as 0% coverage.
        exclude: [
          'src/components/ui/**',
          'src/assets/**',
          'src/tanstack-table.d.ts',
          'src/routeTree.gen.ts',
          'src/test-utils/**',
          'src/routes/**',
        ],
      },
    },
  };
})
