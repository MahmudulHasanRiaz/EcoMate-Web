#!/usr/bin/env node
/**
 * check-perf-budget.mjs — storefront performance budget gate (Speed Plan P8).
 *
 * This is the PR gate. It measures ONLY the PR's own build output
 * (apps/storefront/.next), never a deployed site, so a red result is always
 * attributable to the change under review. (Lighthouse CI lives in
 * .lighthouserc.js at the repo root and is a MANUAL workflow_dispatch job:
 * against staging it measures already-deployed code, so it cannot gate a PR.)
 *
 * METHOD (reproducible, no server / no backend needed)
 *   Next.js prerenders a set of routes at build time; their HTML is written to
 *   .next/server/app/**.html. That HTML is the same document the server sends
 *   first for those routes, so we measure it directly:
 *     - Font preloads: distinct <link rel="preload" as="font"> (or *.woff/woff2
 *       preload) hrefs in the page HTML. Max over all measured pages.
 *     - Initial JS per route: distinct /_next/static/chunks/*.js referenced by
 *       the page HTML (script tags + RSC flight data — the set the browser
 *       downloads for that route), summed from the chunk files on disk,
 *       raw and gzip (zlib level 9). Same method P5 used against `next start`,
 *       applied to the prerendered document instead of a live response.
 *     - Dynamic routes (home, PLP, PDP on current main) have no prerendered
 *       HTML; they are bounded by two build-wide metrics that every route
 *       loads: build-manifest.json `rootMainFiles` (gzip) and the largest
 *       single chunk in .next/static/chunks (gzip). The worst prerendered
 *       route (today: checkout) is the per-route ceiling sample.
 *     - HTML size: largest prerendered page HTML (excl. _not-found/_global-error).
 *
 * THRESHOLDS — plan targets vs today's measured reality (origin/main 63a2e83,
 * measured 2026-11-03 from a sibling build of the same code):
 *   metric                    plan target   warn    error   measured today
 *   font preloads             <= 2          2       2     1 (post-P1; error tightened 10 -> 2 on 2026-11-03)
 *   route JS (worst, gzip)    <= 250 KiB    250     320 *   ~304 KiB (checkout 311,306 B)
 *   root JS (gzip)            —             140     160     ~128.5 KiB (131,585 B)
 *   largest chunk (gzip)      —             80      100     ~71 KiB (73,004 B)
 *   HTML (largest page)       —             64      96      83 KiB (/careers, CI on merged main 2026-11-03; the
 *                                                            earlier 72 KiB local sibling-build figure used
 *                                                            different CMS fallback data — CI is the reference)
 *   * RATCHET: the plan target is NOT met by current code, so error is set at
 *     a freeze/growth ceiling instead of the target — a gate set at the target
 *     today would be red on every PR, including unrelated ones, and would be
 *     ignored within a week. The freeze still goes red on ANY growth past the
 *     ceiling, which is the plan's stated CI purpose. Fonts tightened to the
 *     plan target (error 2) on 2026-11-03 after P1 landed (1 preload). Route
 *     JS stays at the 320 KiB freeze until a future diet brings the worst
 *     route under the 250 KiB target.
 *
 * Every error threshold can be overridden via env (used by the negative
 * tests, and for future tightening without touching this file):
 *   PERF_BUDGET_FONT_PRELOADS_MAX, PERF_BUDGET_ROUTE_JS_GZIP_KIB_MAX,
 *   PERF_BUDGET_ROOT_JS_GZIP_KIB_MAX, PERF_BUDGET_CHUNK_GZIP_KIB_MAX,
 *   PERF_BUDGET_HTML_KIB_MAX        (warn levels: same name + _WARN)
 *
 * USAGE
 *   node apps/storefront/scripts/check-perf-budget.mjs [--next-dir <path>] [--json]
 *   node apps/storefront/scripts/check-perf-budget.mjs --html <file.html> [--next-dir <path>]
 *     --html measures one standalone HTML file (fixture mode; chunk sizes are
 *     resolved from --next-dir when given).
 *
 * EXIT CODES: 0 = pass (warnings allowed), 1 = an error threshold was
 * breached, 2 = could not measure (missing build output / bad arguments).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KiB = 1024;
const DEFAULTS = {
  fontPreloads: { warn: 2, error: 2, env: 'PERF_BUDGET_FONT_PRELOADS_MAX' },
  routeJsGzipKiB: { warn: 250, error: 320, env: 'PERF_BUDGET_ROUTE_JS_GZIP_KIB_MAX' },
  rootJsGzipKiB: { warn: 140, error: 160, env: 'PERF_BUDGET_ROOT_JS_GZIP_KIB_MAX' },
  chunkGzipKiB: { warn: 80, error: 100, env: 'PERF_BUDGET_CHUNK_GZIP_KIB_MAX' },
  htmlKiB: { warn: 64, error: 96, env: 'PERF_BUDGET_HTML_KIB_MAX' },
};

function threshold(cfg) {
  const err = Number(process.env[cfg.env]);
  const warn = Number(process.env[`${cfg.env}_WARN`]);
  return {
    warn: Number.isFinite(warn) && process.env[`${cfg.env}_WARN`] !== undefined ? warn : cfg.warn,
    error: Number.isFinite(err) && process.env[cfg.env] !== undefined ? err : cfg.error,
  };
}

function parseArgs(argv) {
  const args = { json: false, nextDir: null, html: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--next-dir') args.nextDir = argv[++i];
    else if (a === '--html') args.html.push(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

const gzipCache = new Map();
function gzipSize(file) {
  if (!gzipCache.has(file)) {
    const buf = readFileSync(file);
    gzipCache.set(file, { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length });
  }
  return gzipCache.get(file);
}

function walk(dir, ext, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, ext, out);
    else if (entry.name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** Distinct font-preload hrefs in one HTML document. */
function fontPreloads(html) {
  const hrefs = new Set();
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel="preload"/i.test(tag)) continue;
    if (!/as="font"/i.test(tag) && !/\.woff2?(\?|"|$)/i.test(tag)) continue;
    const href = /href="([^"]+)"/i.exec(tag)?.[1];
    hrefs.add(href ?? tag);
  }
  return hrefs;
}

/** Distinct /_next/static/chunks/*.js referenced anywhere in the document. */
function chunkRefs(html) {
  const refs = new Set();
  for (const m of html.matchAll(/_next\/static\/chunks\/[A-Za-z0-9_\-./%]+\.js/g)) {
    refs.add(m[0]);
  }
  return refs;
}

function routeLabel(nextDir, htmlFile) {
  const rel = path.relative(path.join(nextDir, 'server', 'app'), htmlFile).replace(/\\/g, '/');
  let route = `/${rel.replace(/\.html$/, '')}`;
  route = route.replace(/\/(index|page)$/, '') || '/';
  route = route.replace(/\/\([^)]+\)/g, ''); // route groups: (main) etc.
  return route === '' ? '/' : route;
}

function measureHtml(htmlFile, nextDir) {
  const html = readFileSync(htmlFile, 'utf8');
  const chunks = [...chunkRefs(html)];
  let raw = 0;
  let gzip = 0;
  let missing = 0;
  for (const ref of chunks) {
    const file = path.join(nextDir, ref.replace(/^_next\//, ''));
    if (existsSync(file)) {
      const s = gzipSize(file);
      raw += s.raw;
      gzip += s.gzip;
    } else missing += 1;
  }
  return {
    file: htmlFile,
    htmlBytes: Buffer.byteLength(html),
    fontPreloads: fontPreloads(html).size,
    chunkCount: chunks.length,
    missingChunks: missing,
    jsRaw: raw,
    jsGzip: gzip,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: check-perf-budget.mjs [--next-dir <path>] [--html <file>] [--json]');
    return 0;
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const nextDir = args.nextDir
    ? path.resolve(args.nextDir)
    : path.resolve(scriptDir, '..', '.next'); // apps/storefront/.next

  const rows = [];
  const addRow = (metric, value, unit, cfg, note = '') => {
    const t = threshold(cfg);
    const status = value > t.error ? 'FAIL' : value > t.warn ? 'WARN' : 'PASS';
    rows.push({ metric, value, unit, warn: t.warn, error: t.error, status, note });
  };

  if (args.html.length > 0) {
    // Fixture mode: measure exactly the given HTML file(s).
    let worstJs = 0;
    let maxFonts = 0;
    let maxHtml = 0;
    for (const f of args.html) {
      if (!existsSync(f)) { console.error(`HTML file not found: ${f}`); return 2; }
      const m = measureHtml(path.resolve(f), nextDir);
      maxFonts = Math.max(maxFonts, m.fontPreloads);
      worstJs = Math.max(worstJs, m.jsGzip);
      maxHtml = Math.max(maxHtml, m.htmlBytes);
      rows.push({ metric: `fixture ${path.basename(f)} chunks`, value: m.chunkCount, unit: 'files', warn: null, error: null, status: 'INFO', note: m.missingChunks ? `${m.missingChunks} chunk(s) not found under --next-dir (sizes partial)` : '' });
    }
    addRow('font preloads (fixture)', maxFonts, 'count', DEFAULTS.fontPreloads);
    if (worstJs > 0) addRow('initial JS gzip (fixture)', Math.round(worstJs / KiB), 'KiB', DEFAULTS.routeJsGzipKiB);
    addRow('HTML size (fixture)', Math.round(maxHtml / KiB), 'KiB', DEFAULTS.htmlKiB);
  } else {
    if (!existsSync(nextDir)) {
      console.error(`Build output not found: ${nextDir}\nRun \`npm run build\` in apps/storefront first.`);
      return 2;
    }
    const appDir = path.join(nextDir, 'server', 'app');
    const htmlFiles = walk(appDir, '.html').filter(
      (f) => !/(^|\/)(_not-found|_global-error)\.html$/.test(f),
    );
    if (htmlFiles.length === 0) {
      console.error(`No prerendered HTML under ${appDir} — cannot measure. Was the build completed?`);
      return 2;
    }
    const measured = htmlFiles.map((f) => ({ route: routeLabel(nextDir, f), ...measureHtml(f, nextDir) }));

    const maxFonts = Math.max(...measured.map((m) => m.fontPreloads));
    addRow('font preloads (max over prerendered pages)', maxFonts, 'count', DEFAULTS.fontPreloads,
      'plan target <=2; error tightened to target 2026-11-03 (P1 landed, 1 preload)');

    const keyRoutes = ['/', '/checkout', '/cart', '/products'];
    for (const r of keyRoutes) {
      const m = measured.find((x) => x.route === r);
      if (m) {
        rows.push({
          metric: `initial JS gzip — ${r === '/' ? 'home' : r.slice(1)} (prerendered)`,
          value: Math.round(m.jsGzip / KiB), unit: 'KiB', warn: null, error: null, status: 'INFO',
          note: `${m.chunkCount} chunks, raw ${Math.round(m.jsRaw / KiB)} KiB`,
        });
      }
    }
    const dynamic = keyRoutes.filter((r) => !measured.some((x) => x.route === r));
    if (dynamic.length) {
      rows.push({
        metric: 'dynamic key routes (no prerendered HTML)', value: dynamic.join(', '), unit: '',
        warn: null, error: null, status: 'INFO',
        note: 'bounded by root-JS + worst-route metrics below; lab check = manual lhci job',
      });
    }
    const worst = measured.reduce((a, b) => (b.jsGzip > a.jsGzip ? b : a));
    addRow('initial JS gzip — worst prerendered route', Math.round(worst.jsGzip / KiB), 'KiB', DEFAULTS.routeJsGzipKiB,
      `worst: ${worst.route}; plan target <=250 KiB not yet met — ratchet, see header`);

    // Root (every-route) JS from the build manifest.
    const manifestPath = path.join(nextDir, 'build-manifest.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      let gzip = 0;
      let raw = 0;
      for (const f of manifest.rootMainFiles ?? []) {
        const file = path.join(nextDir, f);
        if (existsSync(file)) { const s = gzipSize(file); raw += s.raw; gzip += s.gzip; }
      }
      addRow('root JS gzip (build-manifest rootMainFiles)', Math.round(gzip / KiB), 'KiB', DEFAULTS.rootJsGzipKiB,
        `raw ${Math.round(raw / KiB)} KiB, loaded by every route`);
    }

    // Largest single chunk anywhere in the build — "a big chunk was added" tripwire.
    let largest = { gzip: 0, file: '' };
    for (const f of walk(path.join(nextDir, 'static', 'chunks'), '.js')) {
      const s = gzipSize(f);
      if (s.gzip > largest.gzip) largest = { gzip: s.gzip, file: path.basename(f) };
    }
    addRow('largest single chunk gzip', Math.round(largest.gzip / KiB), 'KiB', DEFAULTS.chunkGzipKiB, largest.file);

    const maxHtml = Math.max(...measured.map((m) => m.htmlBytes));
    addRow('HTML size — largest prerendered page', Math.round(maxHtml / KiB), 'KiB', DEFAULTS.htmlKiB,
      measured.find((m) => m.htmlBytes === maxHtml)?.route ?? '');
  }

  const failed = rows.filter((r) => r.status === 'FAIL');
  if (args.json) {
    console.log(JSON.stringify({ ok: failed.length === 0, rows }, null, 2));
  } else {
    const w = Math.max(...rows.map((r) => r.metric.length));
    console.log('\nStorefront perf budget — build-output gate (P8)');
    console.log(`${'metric'.padEnd(w)}  ${'value'.padStart(10)}  ${'warn'.padStart(6)}  ${'error'.padStart(6)}  result`);
    for (const r of rows) {
      const val = r.unit ? `${r.value} ${r.unit}` : `${r.value}`;
      console.log(`${r.metric.padEnd(w)}  ${val.padStart(10)}  ${String(r.warn ?? '—').padStart(6)}  ${String(r.error ?? '—').padStart(6)}  ${r.status}${r.note ? `  (${r.note})` : ''}`);
    }
    console.log(failed.length === 0
      ? '\nRESULT: PASS (warnings allowed — see ratchet notes in script header)'
      : `\nRESULT: FAIL — ${failed.map((r) => r.metric).join('; ')}`);
  }
  return failed.length === 0 ? 0 : 1;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`check-perf-budget: ${err.message}`);
  process.exit(2);
}
