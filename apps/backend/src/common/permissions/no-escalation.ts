import { ForbiddenException } from '@nestjs/common';

/**
 * Anti-escalation invariant for preset supremacy (owner rule 2026-10-24).
 *
 * Dropping the old `@Roles('superadmin','admin')` gates means a preset holder
 * with `manage_presets` / `manage_employees` / `create_users` could otherwise
 * mint MORE access than they hold — the exact hole the old role gates
 * deliberately closed (see the removed comment in access-presets.controller).
 * The replacement is capability-bounded, not role-bounded: an actor may only
 * grant access they already hold. Superadmins and preset-less admins hold
 * every key, so they pass every check; restricted actors are bounded to
 * their own set.
 *
 * Enforced at the HTTP boundary (controllers pass request.user.permissions).
 * When actorPermissions is undefined (direct service call without an actor),
 * the check is skipped — controllers must always pass it.
 */
export function assertNoEscalation(
  actorPermissions: string[] | undefined,
  granted: string[] | undefined,
  what: string,
): void {
  if (!granted || granted.length === 0) return;
  if (actorPermissions === undefined) return;
  const held = new Set(actorPermissions);
  const beyond = granted.filter((key) => !held.has(key));
  if (beyond.length > 0) {
    throw new ForbiddenException(
      `Cannot grant access you do not hold: ${beyond.join(', ')} (${what})`,
    );
  }
}

/**
 * Role-assignment bound for user creation/update: only an actor holding
 * every permission key may mint an admin or superadmin account. Anything
 * less would let a restricted creator bootstrap a full-access account.
 * Assigning employee/cashier/packing_assistant roles needs no bound: those
 * users get role defaults (nothing) until HR assigns a preset.
 */
export function assertCanAssignRole(
  actorPermissions: string[] | undefined,
  role: string | undefined,
  allKeys: string[],
): void {
  if (role !== 'admin' && role !== 'superadmin') return;
  if (actorPermissions === undefined) return;
  const held = new Set(actorPermissions);
  if (!allKeys.every((key) => held.has(key))) {
    throw new ForbiddenException(
      `Cannot assign role '${role}' without holding full access`,
    );
  }
}
