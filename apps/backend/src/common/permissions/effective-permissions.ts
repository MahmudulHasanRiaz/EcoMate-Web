import { getAllPermissions } from './registry';

export interface ComputeEffectivePermissionsParams {
  role: string;
  employeeLink?: {
    accessPreset?: { permissions: string[] } | null;
  } | null;
  overridePermissions?: string[];
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

export function computeEffectivePermissions(
  params: ComputeEffectivePermissionsParams,
): string[] {
  const { role, overridePermissions } = params;
  if (role === 'superadmin' || role === 'admin') {
    return getAllPermissions();
  }
  if (role === 'customer') {
    return [];
  }
  if (!params.employeeLink) {
    return [];
  }
  const preset = params.employeeLink.accessPreset?.permissions ?? [];
  return sanitizePermissions([...preset, ...(overridePermissions ?? [])]);
}