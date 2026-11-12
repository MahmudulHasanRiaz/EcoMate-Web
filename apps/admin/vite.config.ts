/// <reference types="vitest/config" />
import path from 'path'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { defineConfig, loadEnv, createLogger } from 'vite'
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

  const isTest = process.argv.some((a) => a.includes('vitest'))
  // Vitest browser mode: Vite's dep optimizer otherwise discovers packages
  // lazily AS TEST FILES IMPORT THEM and rebundles mid-run. Every rebundle
  // reloads the test server and can hand components a second copy of React
  // ("Invalid hook call … more than one copy of React"), failing whole test
  // files at random on cold-cache runners — the 2026-11-11 cancelled CI run's
  // own log shows 276 such hook errors after 7 optimizer reloads, while
  // warm-cache local runs stayed green. Fix: in test mode pre-bundle every
  // package the browser can request — the bare specifiers src/ imports
  // directly (roots + subpaths like react-dom/client) — before the first
  // test, and disable discovery, so no mid-run reload can occur. The list
  // is derived by scanning src/, so future imports are covered
  // automatically. Transitive deps need no entry: esbuild inlines them
  // into their importer's chunk.
  const testOptimizeInclude = (() => {
    // Two kinds of packages must never be optimizer entries, or the
    // optimizer itself aborts the run: CSS-only packages (tw-animate-css —
    // no JS entry to resolve) and config-only Node plugins (@tailwindcss/
    // vite — drags in a native .node binding). Scanning src/ imports
    // already excludes both (neither is imported from src/); roots are
    // additionally required to show a real JS entry (main/module or a JS
    // exports["."] target, read from the node_modules chain directly —
    // require.resolve('pkg/package.json') throws for the many packages
    // whose exports map does not expose that subpath) so types-only
    // imports are dropped too.
    const nmRoots = [
      path.join(import.meta.dirname, 'node_modules'),
      path.join(import.meta.dirname, '../../node_modules'),
      path.join(import.meta.dirname, '../../../node_modules'),
    ]
    const hasJsEntry = (name: string): boolean => {
      for (const root of nmRoots) {
        const pkgPath = path.join(root, name, 'package.json')
        if (!existsSync(pkgPath)) continue
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
          const dot = pkg.exports?.['.']
          const flat = (v: unknown): string[] =>
            typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(flat) : []
          return [pkg.module, pkg.main, ...flat(dot)].some(
            (c) => typeof c === 'string' && /\.(m?js|cjs)$/.test(c),
          )
        } catch {
          return true
        }
      }
      return true
    }
    const rootOf = (spec: string) =>
      spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    try {
      const specs = new Set<string>()
      const srcDir = path.join(import.meta.dirname, 'src')
      for (const entry of readdirSync(srcDir, { recursive: true }) as string[]) {
        if (!/\.(ts|tsx)$/.test(entry)) continue
        let text: string
        try {
          text = readFileSync(path.join(srcDir, entry), 'utf-8')
        } catch {
          continue // a directory can carry a .ts-like name — skip unreadables
        }
        for (const m of text.matchAll(/(?:from\s+|import\s*\(?\s*)['"]([^'"]+)['"]/g)) {
          const spec = m[1]
          if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) continue
          if (rootOf(spec) === 'vitest') continue // the runner's own module
          specs.add(rootOf(spec))
          if (spec !== rootOf(spec)) specs.add(spec)
        }
      }
      // Subpaths are trusted as real JS imports; roots must show a JS entry.
      return [...specs].filter((s) => s !== rootOf(s) || hasJsEntry(s))
    } catch {
      return []
    }
  })()

  return {
    base: process.env.VITE_BASE || '/admin/',
    // Test runs (vitest browser mode) intentionally have no backend behind
    // the /api proxy — every such request fails ECONNREFUSED by design (tests
    // mock API at the client level; a few exercise real failure paths).
    // Silence exactly that noise so real errors stay visible. Dev/build
    // logging is untouched (argv has no 'vitest' there).
    ...(isTest
      ? {
          customLogger: (() => {
            const base = createLogger()
            return {
              ...base,
              error: (msg: string, opts?: any) => {
                const errText = String(opts?.error?.stack || opts?.error || '')
                if (msg.includes('http proxy error') && errText.includes('ECONNREFUSED')) return
                base.error(msg, opts)
              },
            }
          })(),
        }
      : {}),
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
        // the service worker stays registered to precache the hashed
        // JS/CSS assets — reloads then load those instantly from the SW
        // cache. The HTML shell itself is deliberately NOT precached
        // (see navigateFallback below): navigations must revalidate.
        manifest: false,
        workbox: {
          // P0 stale-bundle fix (2026-11-12): vite-plugin-pwa 1.3.0
          // defaults navigateFallback to "index.html", which makes
          // Workbox register a NavigationRoute serving the PRECACHED
          // (stale) shell cache-first for every document navigation —
          // the old bundle kept running after deploys even though the
          // server served new bytes. Setting it to undefined removes
          // the route entirely (workbox-build 7.4.1 only emits the
          // NavigationRoute/createHandlerBoundToURL block when the
          // option is truthy — verified in the built dist/sw.js), so
          // navigations always hit the network and get fresh HTML
          // (nginx no-cache on index.html). D18's periodic update
          // checks + controllerchange reload still run on top.
          navigateFallback: undefined,
          // ALSO drop html from the precache: even without a
          // NavigationRoute, workbox-precaching's precacheAndRoute
          // serves a precached index.html cache-first for directory
          // navigations (generateURLVariations defaults directoryIndex
          // to 'index.html', so /admin/ resolves to the precached
          // shell). Hashed JS/CSS/assets stay precached + immutable —
          // only the unversioned shell leaves the cache. Offline cost:
          // none in practice — the admin is online-only (all API calls
          // are NetworkOnly); an offline navigation now fails instead
          // of showing a stale shell.
          globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
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
      {
        // Cloudflare Rocket Loader protection (P0 stale-bundle round,
        // 2026-11-12): the served FixedPlus admin HTML shows Rocket
        // Loader active — rocket-loader.min.js injected and the module
        // entry + registerSW script tags rewritten to hashed types
        // (e.g. type="5c77…-module"), with NO data-cfasync anywhere.
        // Vite strips data-cfasync from the script tag it injects, so
        // add it back here — same pattern as apps/pos
        // (pos vite.config.ts "pos-api-base-html"). Post-order AND after
        // VitePWA in this array, so it runs after VitePWA injects the
        // registerSW tag; both external scripts are then left alone by
        // Rocket Loader instead of being deferred/rewritten. Verified in
        // the built dist/index.html.
        name: 'admin-cfasync',
        // enforce: 'post' is load-bearing: VitePWA's build plugin is
        // also post-enforced and injects the registerSW tag in a
        // post-order transformIndexHtml hook. Without this, this
        // plugin (a normal plugin) sorts BEFORE VitePWA and its
        // registerSW replace runs before the tag exists — the module
        // replace still worked, the registerSW one silently missed
        // (caught by the dist/index.html check, 2026-11-12). With
        // enforce post + later array position, this hook runs after
        // VitePWA's injection.
        enforce: 'post',
        transformIndexHtml: {
          order: 'post',
          handler(html: string) {
            return html
              .replace(
                '<script type="module" crossorigin src=',
                '<script type="module" data-cfasync="false" crossorigin src=',
              )
              .replace(
                '<script id="vite-plugin-pwa:register-sw" src=',
                '<script id="vite-plugin-pwa:register-sw" data-cfasync="false" src=',
              )
          },
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
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
    optimizeDeps: isTest
      ? {
          // Test mode: pre-bundle everything up front (see testOptimizeInclude
          // above) and never discover mid-run — a mid-run rebundle reloads the
          // server and duplicates React, failing random test files.
          include: [...new Set(['@ecomate/shared-types', ...testOptimizeInclude])],
          noDiscovery: true,
        }
      : {
          // @dnd-kit resolves its own React copy when externalized under vitest
          // browser mode ("Invalid hook call" via useMemo) — pre-bundle it so the
          // deduped React is used, like in dev/build.
          include: ['@ecomate/shared-types', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
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
