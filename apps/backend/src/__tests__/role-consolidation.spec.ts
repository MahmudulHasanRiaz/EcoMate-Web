/**
 * Guards the manager → employee consolidation.
 *
 * `manager` was a second name for "employee with broad access", which meant
 * every authorization decision had to consider two role spellings. It has
 * been removed from the Prisma enum, every @Roles() gate, and every frontend
 * role list. These assertions fail if any of those come back.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');
// __dirname is apps/backend/src/__tests__ → schema is apps/backend/prisma.
const SCHEMA = path.resolve(__dirname, '..', '..', 'prisma', 'schema.prisma');

/** Every .controller.ts under apps/backend/src, excluding specs. */
function controllerFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.name.endsWith('.controller.ts')) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
}

describe('role vocabulary: manager is gone', () => {
  it('UserRole enum no longer contains manager', () => {
    const schema = fs.readFileSync(SCHEMA, 'utf8');
    const block = schema.match(/enum UserRole \{([\s\S]*?)\}/);
    expect(block).toBeTruthy();
    const values = [...block![1].matchAll(/^\s*([a-z_]+)\s*$/gm)].map((m) => m[1]);
    expect(values).not.toContain('manager');
    // The five staff/customer roles the product supports.
    expect(values.sort()).toEqual(
      ['admin', 'cashier', 'customer', 'employee', 'packing_assistant', 'superadmin'].sort(),
    );
  });

  it('no @Roles() gate in any controller mentions manager', () => {
    const offenders: string[] = [];
    for (const file of controllerFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      const matches = src.match(/@Roles\([^)]*\)/g) ?? [];
      for (const m of matches) {
        if (m.includes("'manager'")) {
          offenders.push(`${path.relative(SRC, file)}: ${m}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no role array or comparison in controllers/services mentions manager', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
        } else if (
          (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) &&
          fs.readFileSync(full, 'utf8').includes("'manager'")
        ) {
          offenders.push(path.relative(SRC, full));
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});