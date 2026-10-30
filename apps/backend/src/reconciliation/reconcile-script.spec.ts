import { execFile } from 'child_process';
import * as path from 'path';

/**
 * S2 script guard tests (2026-10-30 directive §2.4/§5). Both refusal
 * paths exit BEFORE the Nest context (and any database) is touched, so
 * they are exercised end-to-end against the real script file:
 *   - a bare run is a dry-run (it never reaches an apply code path —
 *     structurally, apply requires BOTH flags below);
 *   - --apply without --client refuses;
 *   - any run refuses while STOCK_RECONCILE_ON_BOOT=true is in env.
 */
const backendDir = path.join(__dirname, '..', '..');

function runScript(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'npx',
      ['tsx', 'prisma/scripts/reconcile-stock.ts', ...args],
      { cwd: backendDir, env, timeout: 110_000 },
      (err, _stdout, stderr) => {
        resolve({ code: err ? ((err as any).code ?? 1) : 0, stderr: String(stderr) });
      },
    );
  });
}

describe('reconcile-stock.ts guards', () => {
  jest.setTimeout(120_000);

  it('--apply without --client refuses (exit 1, no boot)', async () => {
    const env = { ...process.env };
    delete env['STOCK_RECONCILE_ON_BOOT'];
    const { code, stderr } = await runScript(['--apply'], env);
    expect(code).toBe(1);
    expect(stderr).toContain('--apply requires --client');
  });

  it('refuses to run while STOCK_RECONCILE_ON_BOOT=true is in env', async () => {
    const { code, stderr } = await runScript([], {
      ...process.env,
      STOCK_RECONCILE_ON_BOOT: 'true',
    });
    expect(code).toBe(1);
    expect(stderr).toContain('STOCK_RECONCILE_ON_BOOT=true');
  });
});
