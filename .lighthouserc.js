/**
 * Lighthouse CI configuration (Speed Plan P8) — @lhci/cli 0.16.0, which
 * bundles Lighthouse 13.6.0 (verified via npm registry, 2026-11-03).
 *
 * WHY THIS IS *NOT* A PR GATE
 *   A pull request's code is not what is deployed on staging, so running
 *   lhci against the staging URL on a PR would grade somebody else's code
 *   (the last deploy), not the change under review. The real PR gate is the
 *   deterministic build-output budget script:
 *     apps/storefront/scripts/check-perf-budget.mjs
 *   (job `budget` in .github/workflows/perf-budgets.yml, runs on the PR's own
 *   build). This lhci config is wired ONLY to the manual workflow_dispatch
 *   job `lighthouse` in the same workflow, where measuring deployed code is
 *   exactly the point (post-deploy verification / regression watch).
 *
 * MODES (workflow_dispatch inputs)
 *   staging-url (default): LHCI_URL=https://demo.ecomate.bd — audits the
 *     deployed staging site. Scores are meaningful (real backend + data).
 *   local-build: the workflow builds the PR/branch code and sets
 *     LHCI_URL=http://127.0.0.1:3000/ plus LHCI_START_SERVER, so lhci audits
 *     THIS code served by `next start`. Caveat: no backend is running in CI,
 *     so data-driven sections may render fallbacks — treat scores as a shell/
 *     asset signal, not comparable to staging.
 *
 * ASSERTIONS vs PLAN TARGETS (staging home, measured 2026-11-03: Perf 0.94,
 * LCP 2.6 s, TBT 70 ms — see perf-audit evidence). lhci allows ONE level per
 * audit, so where the plan target is not met yet the error level is a
 * documented RATCHET and the plan target is recorded as the TODO:
 *   categories:performance  plan >=0.95  -> error >=0.90 (staging 0.94)
 *   largest-contentful-paint plan <=2500 -> error <=3000 (staging 2600 ms)
 *   total-blocking-time     plan <=300   -> error <=300  (staging 70 ms, met)
 *   resource-summary script plan <=250 KiB (256000 B) -> error <=350 KiB
 *     (358400 B). NOTE: resource-summary script `size`/`transferSize` counts
 *     ALL script bytes Lighthouse observed on the page (incl. third-party),
 *     so it runs higher than the budget script's first-party chunk sum.
 *   TODO(P8): tighten performance to 0.95, LCP to 2500 and script size to
 *   256000 once P1/P5 land on main and staging re-measures at plan level.
 *
 * Font preloads are NOT asserted here: Lighthouse 13.x has no audit that
 * counts <link rel="preload" as="font"> tags, so that budget lives in the
 * PR budget script above, where it is measured exactly.
 */
const targetUrl = process.env.LHCI_URL || 'https://demo.ecomate.bd';
const startServer = process.env.LHCI_START_SERVER || undefined;

module.exports = {
  ci: {
    collect: {
      url: [targetUrl],
      numberOfRuns: 3,
      ...(startServer
        ? { startServerCommand: startServer, startServerReadyPattern: 'Ready in' }
        : {}),
      settings: {
        // Lighthouse's default form factor is mobile; state it explicitly so
        // a future lhci default change cannot silently switch to desktop.
        formFactor: 'mobile',
        chromeFlags: '--no-sandbox --disable-dev-shm-usage',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 3000 }],
        'total-blocking-time': ['error', { maxNumericValue: 300 }],
        'resource-summary:script:size': ['error', { maxNumericValue: 358400 }],
      },
    },
    // No upload target: reports stay in the workflow run's .lighthouseci
    // output. (temporary-public-storage would publish report URLs publicly.)
  },
};
