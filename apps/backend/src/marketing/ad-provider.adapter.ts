import { InsightRow } from './meta-graph.service';

export const AD_PROVIDER_ADAPTER = 'AD_PROVIDER_ADAPTER';

/**
 * Provider-agnostic error categories.
 * Each adapter translates provider-specific errors into these categories.
 */
export enum ProviderErrorCategory {
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  REMOTE_NOT_FOUND = 'REMOTE_NOT_FOUND',
  TEMPORARY_FAILURE = 'TEMPORARY_FAILURE',
  INVALID_REQUEST = 'INVALID_REQUEST',
  UNKNOWN = 'UNKNOWN',
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly category: ProviderErrorCategory,
    readonly providerSlug: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Normalized campaign shape returned by any provider adapter. */
export interface ProviderCampaign {
  providerCampaignId: string;
  name: string;
  objective?: string;
  buyingType?: string;
  status: string;
  effectiveStatus?: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  createdTime?: string;
  updatedTime?: string;
}

/** Normalized ad set shape returned by any provider adapter. */
export interface ProviderAdSet {
  providerAdSetId: string;
  providerCampaignId: string;
  name: string;
  status: string;
  optimizationGoal?: string;
  billingEvent?: string;
  bidStrategy?: string;
  budget?: number;
  startTime?: string;
  endTime?: string;
}

/** Normalized ad shape returned by any provider adapter. */
export interface ProviderAd {
  providerAdId: string;
  providerAdSetId: string;
  name: string;
  creativeId?: string;
  creativeName?: string;
  status: string;
  landingUrl?: string;
  previewUrl?: string;
}

/**
 * Provider-agnostic interface for ad platform integration.
 * Each provider (Meta, TikTok, Google Ads) implements this interface.
 * Core Marketing Attribution services depend on this interface, NOT on
 * provider-specific implementations.
 *
 * The adapter handles:
 *  - Token management (validation, exchange, refresh)
 *  - Data normalization (provider API → normalized shapes)
 *  - Error translation (provider errors → ProviderError categories)
 *  - Pagination (provider-specific → flat arrays)
 */
export interface AdProviderAdapter {
  readonly providerSlug: string;

  /** Validate an access token and return the provider user ID. */
  validateConnection(accessToken: string): Promise<{ valid: boolean; providerUserId?: string; providerBusinessId?: string }>;

  /** Exchange a short-lived token for a long-lived token. */
  exchangeToken(accessToken: string, appId: string, appSecret: string): Promise<{ accessToken: string; expiresIn: number }>;

  /** Refresh a long-lived token. Falls back to exchange if refresh is unsupported. */
  refreshToken(refreshToken: string, appId: string, appSecret: string): Promise<{ accessToken: string; expiresIn: number }>;

  /**
   * Debug/inspect a token's expiry and scopes.
   * Used by connections service for token health checks.
   */
  debugToken(accessToken: string): Promise<{ expiresAt?: number; scopes?: string[] }>;

  // ── Account-level methods ─────────────────────────────────────────────

  /** List ad accounts accessible with the given token. Returns raw provider data. */
  listAdAccounts(accessToken: string): Promise<Record<string, unknown>[]>;

  // ── Sync-level methods ──────────────────────────────────────────────
  // These methods normalize provider-specific API responses into
  // provider-agnostic shapes. The adapter handles pagination internally.

  /** List campaigns for an ad account. Returns normalized campaign data. */
  listCampaigns(accessToken: string, providerAccountId: string): Promise<ProviderCampaign[]>;

  /** List ad sets across the account. Returns normalized ad set data with campaign linkage. */
  listAdSets(accessToken: string, providerAccountId: string): Promise<ProviderAdSet[]>;

  /** List ads across the account. Returns normalized ad data with ad set linkage. */
  listAds(accessToken: string, providerAccountId: string): Promise<ProviderAd[]>;

  /** Fetch daily insights (campaign-level, one row per campaign per day). */
  fetchInsights(accessToken: string, providerAccountId: string, dateRange: { since: string; until: string }): Promise<InsightRow[]>;

  // ── Campaign controls ───────────────────────────────────────────────

  /** Pause a campaign. Idempotent if already paused. */
  pauseCampaign(accessToken: string, providerCampaignId: string): Promise<void>;

  /** Resume a paused campaign. Idempotent if already active. */
  resumeCampaign(accessToken: string, providerCampaignId: string): Promise<void>;

  // ── Token refresh with retry ────────────────────────────────────────

  /**
   * Execute a provider API call with automatic token refresh on auth failure.
   * The adapter handles the retry logic using its own token refresh mechanism.
   * The connection object is opaque to the adapter — only used for credential retrieval.
   */
  withTokenRefresh<T>(
    connection: any,
    getDecryptedToken: (connection: any) => { token: string },
    refreshLongLivedToken: (connectionId: string) => Promise<any>,
    fn: (token: string) => Promise<T>,
  ): Promise<T>;
}
