/**
 * probe_ddl coverage enforcement — the 20261113160000 lesson, part 2.
 *
 * A single failed migration row in `_prisma_migrations` makes
 * `migrate deploy` refuse to run anything (P3009) until a human resolves it.
 * The startup self-heal (`resolve-failed-migrations.sh`) can only auto-resolve
 * migrations it can CLASSIFY via a `probe_ddl()` entry — APPLIED (DDL landed)
 * or NOT_APPLIED (safe to re-run). Migration `20261113160000` shipped with NO
 * probe entry (its header claimed it "cannot fail"), so when its INSERT
 * failed on staging the boot FATALed — "cannot safely auto-resolve" — and
 * the backend crash-looped on every restart instead of healing.
 *
 * This spec enforces the standing rule nothing enforced before: every
 * migration at/after PROBE_COVERAGE_CUTOFF must have a `probe_ddl()` entry
 * in `resolve-failed-migrations.sh`, or an explicit exemption below with a
 * one-line reason. New migrations without a probe fail the gate.
 *
 * Cutoff rationale (same grandfathering as P0_MIGRATION_CUTOFF): migrations
 * before 2026-11-13 pre-date probe enforcement — they are evidence of why
 * the rule exists, not violations. The real-DB migrate-deploy check (CI
 * guards job) is the backstop for those: a broken old migration still fails
 * the build there.
 *
 * Test override (for proving the check): RESOLVE_SCRIPT_PATH env var points
 * the spec at a copied script.
 */
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'prisma', 'migrations');
const DEFAULT_RESOLVE_SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'resolve-failed-migrations.sh',
);

/** Migrations sorting after this prefix must have a probe (or an exemption). */
export const PROBE_COVERAGE_CUTOFF = '20261113';

/**
 * Explicit exemptions: migration folder name → one-line reason. Empty today.
 * An exemption is for a migration whose failure genuinely needs no probe
 * (say so in the reason) — never a shortcut for skipping the probe.
 */
const PROBE_EXEMPTIONS: Record<string, string> = {
  // Data-only, conditional cleanup: only rows whose config still equals a
  // known fake snapshot change, and a database with no such rows is
  // indistinguishable before/after — no sound APPLIED/NOT_APPLIED probe
  // exists (see the migration header). The per-row exception guard is the
  // safety mechanism; a failed row fails safe to manual resolution.
  '20261113170000_cms_fake_defaults_cleanup':
    'data-only conditional cleanup; no sound probe exists (see migration header)',
};

function migrationsDir(): string {
  return process.env.MIGRATIONS_DIR
    ? path.resolve(process.env.MIGRATIONS_DIR)
    : DEFAULT_MIGRATIONS_DIR;
}

function resolveScriptPath(): string {
  return process.env.RESOLVE_SCRIPT_PATH
    ? path.resolve(process.env.RESOLVE_SCRIPT_PATH)
    : DEFAULT_RESOLVE_SCRIPT;
}

/** Migration names with a probe_ddl() case entry in the resolve script. */
export function probeNames(scriptPath: string): Set<string> {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const start = src.indexOf('probe_ddl() {');
  if (start === -1) throw new Error(`probe_ddl() not found in ${scriptPath}`);
  const endMarker = '# --- Smart UNKNOWN recovery';
  const end = src.indexOf(endMarker, start);
  const body = src.slice(start, end === -1 ? undefined : end);
  const names = new Set<string>();
  for (const m of body.matchAll(/^    (\d{14}[a-z0-9_]*?)\)/gm)) {
    names.add(m[1]);
  }
  return names;
}

function migrationDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d/.test(e.name))
    .map((e) => e.name)
    .sort();
}

describe('probe_ddl coverage (20261113160000 lesson)', () => {
  it('every post-cutoff migration has a probe_ddl entry or an explicit exemption', () => {
    const probes = probeNames(resolveScriptPath());
    const uncovered = migrationDirs(migrationsDir())
      .filter((d) => d > PROBE_COVERAGE_CUTOFF)
      .filter((d) => !probes.has(d) && !(d in PROBE_EXEMPTIONS));
    expect(uncovered).toEqual([]);
  });

  it('probe entries and exemptions reference real migration dirs (no stale entries)', () => {
    const dirs = new Set(migrationDirs(migrationsDir()));
    const probes = probeNames(resolveScriptPath());
    const staleProbes = [...probes].filter((p) => !dirs.has(p)).sort();
    const staleExemptions = Object.keys(PROBE_EXEMPTIONS)
      .filter((e) => !dirs.has(e))
      .sort();
    expect({ staleProbes, staleExemptions }).toEqual({ staleProbes: [], staleExemptions: [] });
  });
});
