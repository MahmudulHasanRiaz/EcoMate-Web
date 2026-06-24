export interface LicenseToken {
  clientId: string;
  plan: PlanType;
  packages: string[];
  customFeatures: string[];
  limits: ResourceLimits;
  exp: number;
  iat: number;
}

export type PlanType = 'essential' | 'growth' | 'enterprise' | 'ultimate' | 'custom';

export const PLAN_TYPES: readonly PlanType[] = ['essential', 'growth', 'enterprise', 'ultimate', 'custom'] as const;

export function isPlanType(v: string): v is PlanType {
  return PLAN_TYPES.includes(v as PlanType);
}

export interface ResourceLimits {
  cpus: number;
  memory: string;
  users: number;
  stores: number;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  planMin: PlanType;
}

export const FEATURES: Record<string, FeatureFlag> = {
  'pos': { key: 'pos', enabled: true, planMin: 'growth' },
  'multi-warehouse': { key: 'multi-warehouse', enabled: true, planMin: 'enterprise' },
  'advanced-reports': { key: 'advanced-reports', enabled: true, planMin: 'enterprise' },
  'coupons': { key: 'coupons', enabled: true, planMin: 'growth' },
  'custom-reports': { key: 'custom-reports', enabled: true, planMin: 'ultimate' },
  'supplier-management': { key: 'supplier-management', enabled: true, planMin: 'growth' },
  'purchase-management': { key: 'purchase-management', enabled: true, planMin: 'growth' },
  'expense-management': { key: 'expense-management', enabled: true, planMin: 'growth' },
  'inventory-advance': { key: 'inventory-advance', enabled: true, planMin: 'enterprise' },
  'notification-gateway': { key: 'notification-gateway', enabled: true, planMin: 'growth' },
};
