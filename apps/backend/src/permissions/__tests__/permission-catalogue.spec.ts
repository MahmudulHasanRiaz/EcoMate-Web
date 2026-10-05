/**
 * Contract tests for the permission catalogue.
 *
 * The catalogue is the single source of truth for what an access preset can
 * grant. It replaced a hand-maintained flat registry plus a second,
 * independently hand-maintained copy in the admin UI — and those two drifted
 * badly enough that 14 of 40 registered keys (every HR and courier-settlement
 * key) could not be granted from the editor at all.
 *
 * These tests exist so that class of drift cannot come back silently.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  CATALOGUE_MODULES,
  PERMISSION_CATALOGUE,
  LEGACY_PERMISSION_KEYS,
  getAllCatalogueKeys,
  isCatalogueKey,
} from '../permission-catalogue';
import { getAllPermissions } from '../../common/permissions/registry';
import { PERMISSIONS } from '../../common/permissions/registry';

const SRC = path.resolve(__dirname, '..');

describe('permission catalogue', () => {
  it('has no duplicate keys', () => {
    const keys = PERMISSION_CATALOGUE.map((e) => e.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it('gives every entry a label and a module', () => {
    for (const e of PERMISSION_CATALOGUE) {
      expect(e.label).toBeTruthy();
      expect(e.module).toBeTruthy();
    }
  });

  it('references only declared modules (legacy entries included)', () => {
    const moduleKeys = new Set(CATALOGUE_MODULES.map((m) => m.key));
    for (const e of PERMISSION_CATALOGUE) {
      expect(moduleKeys.has(e.module)).toBe(true);
    }
  });

  it('generates full CRUD for every module that declares crud', () => {
    for (const mod of CATALOGUE_MODULES) {
      if (!mod.crud) continue;
      for (const verb of ['view', 'create', 'edit', 'delete']) {
        expect(isCatalogueKey(`${verb}_${mod.key}`)).toBe(true);
      }
    }
  });

  it('gives modules without CRUD at least one capability', () => {
    for (const mod of CATALOGUE_MODULES) {
      const count = PERMISSION_CATALOGUE.filter((e) => e.module === mod.key).length;
      expect(count).toBeGreaterThan(0);
    }
  });

  describe('backwards compatibility with already-granted permissions', () => {
    /**
     * The critical invariant. `sanitizePermissions` drops any key the registry
     * does not recognise, so a key present in a live database but missing from
     * the catalogue is silently revoked — the preset still shows a tick while
     * the permission stops working.
     */
    it('keeps every legacy registry key resolvable', () => {
      const legacy = Object.values(PERMISSIONS).flat() as string[];
      const missing = legacy.filter((k) => !isCatalogueKey(k));
      expect(missing).toEqual([]);
    });

    it('keeps every declared legacy key resolvable', () => {
      const missing = LEGACY_PERMISSION_KEYS.filter((k) => !isCatalogueKey(k));
      expect(missing).toEqual([]);
    });

    it('exposes legacy keys through the shared registry too', () => {
      const all = getAllPermissions();
      for (const k of LEGACY_PERMISSION_KEYS) {
        expect(all).toContain(k);
      }
    });

    it('rejects a key that is genuinely not in the catalogue', () => {
      expect(isCatalogueKey('view_hr_not_real')).toBe(false);
    });
  });

  describe('key naming', () => {
    it('uses snake_case verb_module for generated keys', () => {
      const generated = PERMISSION_CATALOGUE.filter(
        (e) => !LEGACY_PERMISSION_KEYS.includes(e.key),
      ).map((e) => e.key);
      const bad = generated.filter(
        (k) => !/^[a-z][a-z0-9_]*$/.test(k),
      );
      expect(bad).toEqual([]);
    });
  });
});

/**
 * Drift guard for the decorators actually used in the codebase.
 *
 * A `@Permissions('view_hrd')` typo compiles fine and then 403s forever with no
 * signal, so every literal must resolve to a real key.
 */
describe('permission decorators resolve to real keys', () => {
  function controllerAndServiceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
        } else if (
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.spec.ts') &&
          !entry.name.includes('.dto.')
        ) {
          out.push(full);
        }
      }
    };
    walk(SRC);
    return out;
  }

  it('every @Permissions / @PermissionsAny literal is a known key', () => {
    const offenders: string[] = [];
    for (const file of controllerAndServiceFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      const matches = src.match(/@Permissions(?:Any)?\(([^)]*)\)/g) ?? [];
      for (const call of matches) {
        const literals = [...call.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
        for (const key of literals) {
          if (!isCatalogueKey(key)) {
            offenders.push(`${path.relative(SRC, file)}: ${call}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the catalogue is non-trivially sized', () => {
    // A guard against a broken generator silently collapsing to a handful.
    expect(getAllCatalogueKeys().length).toBeGreaterThan(100);
  });
});