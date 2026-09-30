/// <reference types="vitest/config" />
import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { VitePWA } from 'vite-plugin-pwa'
import viteCompression from 'vite-plugin-compression'
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
      // Warmup: pre-transform the shell + most-visited routes on dev-server
      // start, so the first page load (and tunnel visits) don't pay the
      // per-file transform cost on demand. Only affects `vite dev`.
      warmup: {
        clientFiles: [
          './src/components/layout/authenticated-layout.tsx',
          './src/routes/_authenticated/op/overview.tsx',
          './src/routes/_authenticated/op/orders/index.tsx',
          './src/features/dashboard/**/*.tsx',
        ],
      },
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
        // autoCodeSplitting OFF: it emits 250+ tiny chunks; on HTTP/1.1 with
        // slow TTFB each file costs a full round trip (15s+ hard reload).
        // manualChunks below bundles vendors; routes stay in a few chunks.
        autoCodeSplitting: false,
      }),
      react(),
      tailwindcss(),
      // Precompress js/css/html at build time. nginx serves the .gz directly
      // (gzip_static) instead of compressing on every request — cuts TTFB.
      viteCompression({ algorithm: 'gzip', ext: '.gz', threshold: 1024 }),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        // No manifest: the admin must not be installable (license gate), but
        // the service worker stays registered to precache app-shell assets —
        // full page reloads then load instantly from the SW cache.
        manifest: false,
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // Workbox's 2 MiB precache default THROWS (fails the build) as soon
          // as any emitted asset grows past it. The eagerly-loaded app entry
          // is ~2.1 MB, so raise the limit to comfortably clear it; every
          // chunk is still precached (verified in the generated sw.js).
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
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
      rollupOptions: {
        output: {
          // Bundle node_modules into a few large vendor chunks instead of
          // 100+ tiny files. With HTTP/1.1 (6 parallel connections) and slow
          // TTFB, each file costs a full round trip — 144 files × 1.7s ÷ 6
          // = 15s+ on hard reload. 4 vendor chunks × 1.7s ÷ 6 = ~2s.
          // Hashed filenames + immutable cache headers keep caching effective.
          //
          // FIRST-PARTY code is intentionally NOT assigned a chunk here: the
          // entry eagerly loads every route, so naming app code just merges it
          // back into the entry (manualChunks is a hint) while risking the
          // precache limit. App code is left to the default splitting; the
          // precache limit above is what bounds the build.
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('recharts')) return 'vendor-charts';
              if (id.includes('@tanstack')) return 'vendor-tanstack';
              if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/'))
                return 'vendor-react';
              return 'vendor';
            }
          },
        },
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
