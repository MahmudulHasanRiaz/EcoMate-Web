import { getAllPermissions } from './registry';

export interface ComputeEffectivePermissionsParams {
  role: string;
  employeeLink?: {
    accessPresetId?: string | null;
    accessPreset?: { permissions: string[] } | null;
  } | null;
  /**
   * Custom additions, edited ONLY in Employee Management (HR) — never in
   * normal User Management. A hand-picked set with no linked preset behaves
   * as a custom preset (owner Q2).
   */
  overridePermissions?: string[];
  /**
   * Custom removals, edited ONLY in Employee Management (HR). Lets a preset
   * grant a capability while one employee loses exactly that capability
   * (owner Q3: preset + custom decrease/increase, done as deltas so a later
   * preset edit still propagates to everyone on it).
   */
  deniedPermissions?: string[];
}

const knownKeys = new Set<string>(getAllPermissions());

export function sanitizePermissions(keys: string[] | undefined): string[] {
  if (!keys || keys.length === 0) return [];
  const out: string[] = [];
  for (const key of keys) {
    if (knownKeys.has(key) && !out.includes(key)) {
      out.push(key);
    }
  }
  return out;
}

/**
 * Owner rule (2026-10-24, absolute): the Access Preset is supreme everywhere.
 * When a preset is in use, it IS the user's access — role defaults add
 * nothing and subtract nothing. Only a user with NO preset at all falls back
 * to role defaults.
 *
 * - superadmin is ALWAYS all-open, even with an employee profile + preset
 *   (owner Q1; only the profile's non-access parts apply to superadmin).
 * - A linked preset always counts as "in use", even an empty one (an
 *   intentionally empty preset means no access, not "fall back to role").
 * - For non-admin roles, hand-picked custom access (adds and/or removes)
 *   also counts as a preset in use, so a custom set behaves like a preset.
 * - JUDGMENT CALL (flagged for owner correction): for role admin, a stray
 *   override alone does NOT count as a preset in use. Reason: the old user
 *   dialog wrote overrides onto admins as no-op extras (admin already had
 *   everything), so treating a legacy override row as "custom preset" would
 *   silently strip an admin down to that list on deploy. An admin is
 *   restricted only by a linked employee preset. If the owner wants
 *   override-alone to restrict admins too, delete the `role !== 'admin'`
 *   condition below.
 */
export function computeEffectivePermissions(
  params: ComputeEffectivePermissionsParams,
): string[] {
  const { role, overridePermissions, deniedPermissions } = params;
  if (role === 'superadmin') {
    return getAllPermissions();
  }
  if (role === 'customer') {
    return [];
  }
  const preset = params.employeeLink?.accessPreset?.permissions ?? [];
  const adds = overridePermissions ?? [];
  const denies = deniedPermissions ?? [];
  const presetInUse =
    params.employeeLink?.accessPresetId != null ||
    (role !== 'admin' && (adds.length > 0 || denies.length > 0));
  if (presetInUse) {
    const granted = sanitizePermissions([...preset, ...adds]);
    const deniedSet = new Set(sanitizePermissions(denies));
    return granted.filter((key) => !deniedSet.has(key));
  }
  // No preset in use: role defaults.
  if (role === 'admin') {
    return getAllPermissions();
  }
  return [];
}
