/**
 * Shared Capacitor utilities for EcoMate mobile apps.
 *
 * These are TypeScript interfaces and helpers that both the native
 * layer (Swift/Kotlin) and the web layer reference. The actual native
 * implementations live in each app's android/ and ios/ directories.
 */

/**
 * License status response from the backend API.
 */
export interface LicenseStatus {
  active: boolean;
  state: 'active' | 'inactive' | 'expired' | 'offline' | 'uninitialized';
  features: string[];
  message: string;
}

/**
 * Result of a native license check.
 */
export interface LicenseCheckResult {
  granted: boolean;
  status: LicenseStatus | null;
  reason?: string;
}

/**
 * Supported mobile app identifiers.
 */
export type MobileAppId = 'storefront' | 'admin' | 'pos';
