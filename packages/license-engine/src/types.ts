export interface LicensePlan {
  id: string;
  name: string;
  planType: string;
  price: number;
}

export interface LicenseInfo {
  valid: boolean;
  code?: string;
  detail?: string;
  plan?: LicensePlan;
  features?: string[];
  limits?: Record<string, number>;
  domains?: string[];
  expiry?: string;
  lastCheckIn?: string;
}

export interface LicensePayload {
  clientId: string;
  plan: string;
  features: string[];
  domains?: string[];
  limits?: Record<string, number>;
  exp?: number;
  iat?: number;
  machineId?: string;
}

export interface LimitResult {
  ok: boolean;
  allowed: number;
  current: number;
  remaining: number;
}

export interface LicenseEngineOptions {
  keymateUrl: string;
  apiKey?: string;
  offlineGraceMs?: number;
}
