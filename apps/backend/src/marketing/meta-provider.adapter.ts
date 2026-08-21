import { Injectable, Logger } from '@nestjs/common';
import { MetaGraphService, MetaApiError, InsightRow } from './meta-graph.service';
import {
  AdProviderAdapter,
  ProviderCampaign,
  ProviderAdSet,
  ProviderAd,
  ProviderError,
  ProviderErrorCategory,
} from './ad-provider.adapter';

/**
 * Meta/Facebook Ads provider adapter.
 * Wraps MetaGraphService and normalizes its API to the AdProviderAdapter interface.
 * This is the ONLY file that should contain Meta-specific API logic.
 */
@Injectable()
export class MetaProviderAdapter implements AdProviderAdapter {
  readonly providerSlug = 'facebook';
  private readonly logger = new Logger(MetaProviderAdapter.name);

  constructor(private readonly metaGraph: MetaGraphService) {}

  // ── Error translation ───────────────────────────────────────────────

  private translateError(err: unknown): ProviderError {
    if (err instanceof MetaApiError) {
      if (err.code === 190) {
        return new ProviderError(
          'Access token has expired. Reconnect the ad account.',
          ProviderErrorCategory.AUTHENTICATION_FAILED,
          this.providerSlug,
          err,
        );
      }
      if (err.code === 4) {
        return new ProviderError(
          'Token type is invalid for this operation.',
          ProviderErrorCategory.AUTHENTICATION_FAILED,
          this.providerSlug,
          err,
        );
      }
      if (err.code === 100) {
        return new ProviderError(
          `Invalid request parameters: ${err.message}`,
          ProviderErrorCategory.INVALID_REQUEST,
          this.providerSlug,
          err,
        );
      }
      if (err.code === 32 || err.code === 613) {
        return new ProviderError(
          'Rate limited by provider. Retry later.',
          ProviderErrorCategory.RATE_LIMITED,
          this.providerSlug,
          err,
        );
      }
      if (err.code === 803 || err.code === 100 || err.code === 200) {
        return new ProviderError(
          `Resource not found: ${err.message}`,
          ProviderErrorCategory.REMOTE_NOT_FOUND,
          this.providerSlug,
          err,
        );
      }
      return new ProviderError(
        err.message,
        ProviderErrorCategory.UNKNOWN,
        this.providerSlug,
        err,
      );
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return new ProviderError(
        'Provider request timed out.',
        ProviderErrorCategory.TEMPORARY_FAILURE,
        this.providerSlug,
        err,
      );
    }
    return new ProviderError(
      err instanceof Error ? err.message : String(err),
      ProviderErrorCategory.UNKNOWN,
      this.providerSlug,
      err,
    );
  }

  // ── Connection lifecycle ────────────────────────────────────────────

  async validateConnection(accessToken: string) {
    try {
      const me = await this.metaGraph.request('me', accessToken, { fields: 'id,name' });
      return { valid: !!me.id, providerUserId: me.id };
    } catch {
      return { valid: false };
    }
  }

  async exchangeToken(accessToken: string, appId: string, appSecret: string) {
    const data = await this.metaGraph.request('oauth/access_token', accessToken, {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: accessToken,
    });
    return { accessToken: data.access_token, expiresIn: data.expires_in ?? 60 * 24 * 60 * 60 };
  }

  async refreshToken(refreshToken: string, appId: string, appSecret: string) {
    return this.exchangeToken(refreshToken, appId, appSecret);
  }

  async debugToken(accessToken: string) {
    const data = await this.metaGraph.request('debug_token', accessToken, { input_token: accessToken });
    const info = data.data ?? {};
    return { expiresAt: info.expires_at, scopes: info.scopes };
  }

  // ── Sync-level methods (normalized shapes) ──────────────────────────

  async listCampaigns(accessToken: string, accountId: string): Promise<ProviderCampaign[]> {
    const raw = await this.metaGraph.listCampaigns(accountId, accessToken);
    return raw.map((c: any) => ({
      providerCampaignId: c.id,
      name: c.name ?? 'Unknown campaign',
      objective: c.objective,
      buyingType: c.buying_type,
      status: c.status ?? 'UNKNOWN',
      effectiveStatus: c.effective_status,
      dailyBudget: c.daily_budget ? Number(c.daily_budget) : undefined,
      lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) : undefined,
      createdTime: c.created_time,
      updatedTime: c.updated_time,
    }));
  }

  async listAdSets(accessToken: string, accountId: string): Promise<ProviderAdSet[]> {
    const raw = await this.metaGraph.listAdSets(accountId, accessToken);
    return raw.map((s: any) => ({
      providerAdSetId: s.id,
      providerCampaignId: s.campaign_id,
      name: s.name ?? 'Unknown ad set',
      status: s.status ?? 'UNKNOWN',
      optimizationGoal: s.optimization_goal,
      billingEvent: s.billing_event,
      bidStrategy: s.bid_strategy,
      budget: s.daily_budget ? Number(s.daily_budget) : undefined,
      startTime: s.start_time,
      endTime: s.end_time,
    }));
  }

  async listAds(accessToken: string, accountId: string): Promise<ProviderAd[]> {
    const raw = await this.metaGraph.listAds(accountId, accessToken);
    return raw.map((a: any) => ({
      providerAdId: a.id,
      providerAdSetId: a.adset_id,
      name: a.name ?? 'Unknown ad',
      creativeId: a.creative?.id,
      creativeName: a.creative?.name,
      status: a.status ?? 'UNKNOWN',
    }));
  }

  async fetchInsights(accessToken: string, accountId: string, dateRange: { since: string; until: string }): Promise<InsightRow[]> {
    return this.metaGraph.fetchInsights(accountId, accessToken, dateRange.since, dateRange.until);
  }

  // ── Campaign controls ───────────────────────────────────────────────

  async pauseCampaign(accessToken: string, providerCampaignId: string) {
    await this.metaGraph.request(providerCampaignId, accessToken, {}, 'POST', { status: 'PAUSED' });
  }

  async resumeCampaign(accessToken: string, providerCampaignId: string) {
    await this.metaGraph.request(providerCampaignId, accessToken, {}, 'POST', { status: 'ACTIVE' });
  }

  // ── Account-level methods ─────────────────────────────────────────────

  async listAdAccounts(accessToken: string): Promise<Record<string, unknown>[]> {
    const body = await this.metaGraph.request('me/adaccounts', accessToken, {
      fields: 'id,name,currency,timezone_name,account_status',
      limit: 250,
    });
    return (body.data ?? []) as Record<string, unknown>[];
  }

  // ── Token refresh with retry ────────────────────────────────────────

  async withTokenRefresh<T>(
    connection: any,
    getDecryptedToken: (connection: any) => { token: string },
    refreshLongLivedToken: (connectionId: string) => Promise<any>,
    fn: (token: string) => Promise<T>,
  ): Promise<T> {
    const { token } = getDecryptedToken(connection);
    try {
      return await fn(token);
    } catch (err) {
      const translated = this.translateError(err);
      if (translated.category !== ProviderErrorCategory.AUTHENTICATION_FAILED) {
        throw translated;
      }
      const refreshed = await refreshLongLivedToken(connection.id);
      if (!refreshed) throw translated;
      const { token: newToken } = getDecryptedToken(refreshed);
      this.logger.log(
        `Token refreshed for connection ${connection.id}; retrying provider call`,
      );
      return fn(newToken);
    }
  }
}
