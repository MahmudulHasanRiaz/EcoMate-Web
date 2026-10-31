import { getAllPermissions } from './registry';

export interface ComputeEffectivePermissionsParams {
  role: string;
  employeeLink?: {
    accessPresetId?: string | null;
    accessPreset?: { permissions: unknown } | null;
  } | null;
  /**
   * Custom additions, edited ONLY in Employee Management (HR) — never in
   * normal User Management. A hand-picked set with no linked preset behaves
   * as a custom preset (owner Q2).
   *
   * Typed `unknown` on purpose: these values come from Prisma Json columns
   * (`better_auth_users.override_permissions` / `denied_permissions`,
   * `access_presets.permissions`). A legacy or hand-edited row can hold a
   * non-array JSON value, and this computation runs on EVERY authenticated
   * request — spreading/iterating a non-array threw a TypeError and 500'd
   * the whole request (the fixedplus HR-presets incident, 2026-10-31).
   * asKeyArray() below coerces anything malformed to [].
   */
  overridePermissions?: unknown;
  /**
   * Custom removals, edited ONLY in Employee Management (HR). Lets a preset
   * grant a capability while one employee loses exactly that capability
   * (owner Q3: preset + custom decrease/increase, done as deltas so a later
   * preset edit still propagates to everyone on it).
   */
  deniedPermissions?: unknown;
}

/**
 * Coerce a stored permission list to a clean string array. Non-array JSON
 * (object/string/number/null) becomes [], and non-string entries are
 * dropped — a malformed stored value must degrade to "no keys from this
 * source", never crash the caller.
 */
export function asKeyArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

const knownKeys = new Set<string>(getAllPermissions());

/**
 * Role defaults for staff WITHOUT a preset in use (no linked preset and no
 * custom adds/removes — see computeEffectivePermissions below).
 *
 * Owner rule 2026-10-28 (client-batch auto-align): the @Permissions
 * conversion took these four read/approve keys away from preset-less
 * employees, who previously held them through employee-inclusive gates
 * (media view, reviews view+approve, COD-mismatch view). Restoring exactly
 * those four — no more — keeps a previously-working flow working without
 * inventing new access. Cashier and packing_assistant keep []: they lost
 * nothing in the conversion, so minimal change is the correct change.
 * A linked preset (even an empty one) still wins over these defaults.
 */
export const EMPLOYEE_DEFAULT_PERMISSIONS: readonly string[] = [
  'view_media',
  'view_customer_reviews',
  'approve_customer_reviews',
  'view_cod_mismatch',
];

/**
 * Single shared role-default function. The login response (auth.service),
 * the request guard (dual-mode-auth.guard) and the preset computation all
 * used to carry their own inline copy of this ternary — and those copies
 * drifted. Use this everywhere a "no preset in use" fallback is needed.
 */
export function getRoleDefaultPermissions(role: string): string[] {
  if (role === 'admin') {
    return getAllPermissions();
  }
  if (role === 'employee') {
    return [...EMPLOYEE_DEFAULT_PERMISSIONS];
  }
  return [];
}

export function sanitizePermissions(keys: unknown): string[] {
  const list = asKeyArray(keys);
  if (list.length === 0) return [];
  const out: string[] = [];
  for (const key of list) {
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
  const preset = asKeyArray(params.employeeLink?.accessPreset?.permissions);
  const adds = asKeyArray(overridePermissions);
  const denies = asKeyArray(deniedPermissions);
  const presetInUse =
    params.employeeLink?.accessPresetId != null ||
    (role !== 'admin' && (adds.length > 0 || denies.length > 0));
  if (presetInUse) {
    const granted = sanitizePermissions([...preset, ...adds]);
    const deniedSet = new Set(sanitizePermissions(denies));
    return granted.filter((key) => !deniedSet.has(key));
  }
  // No preset in use: role defaults (shared helper — keep the three
  // call sites in sync through it, never another inline copy).
  return getRoleDefaultPermissions(role);
}
