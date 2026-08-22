import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { REQUEST_TIMEOUT_MS } from './marketing.constants';

const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

interface MetaErrorResponse {
  error?: { code?: number; error_subcode?: number; message?: string };
}

export interface InsightRow {
  campaignId: string;
  date: string;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  spend: number;
  frequency: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
}

@Injectable()
export class MetaGraphService {
  private readonly logger = new Logger(MetaGraphService.name);

  async request(
    path: string,
    accessToken: string,
    params: Record<string, string | number | boolean> = {},
    method: 'GET' | 'POST' = 'GET',
    body?: Record<string, string | number | boolean>,
  ): Promise<any> {
    const url = new URL(`${META_GRAPH_BASE}/${path}`);
    url.searchParams.set('access_token', accessToken);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    const init: RequestInit = { method, headers, signal: undefined };
    const controller = new AbortController();
    init.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      if (body && Object.keys(body).length > 0) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        init.body = new URLSearchParams(
          Object.entries(body).map(([k, v]) => [k, String(v)]),
        ).toString();
      }
      const res = await fetch(url.toString(), init);
      const data: MetaErrorResponse = await res.json();
      if (!res.ok || data.error) {
        const code = data.error?.code;
        if (code === 190) {
          throw new MetaApiError(
            'Access token has expired. Reconnect the ad account.',
            code,
            data.error?.error_subcode,
          );
        }
        if (code === 4 && data.error?.error_subcode === 2446079) {
          throw new MetaApiError(
            'Page access token is in use. Use a separate long-lived user token.',
            code,
            data.error?.error_subcode,
          );
        }
        if (code === 100) {
          throw new MetaApiError(
            `Facebook returned invalid parameters: ${data.error?.message ?? 'unknown'}`,
            code,
            data.error?.error_subcode,
          );
        }
        throw new MetaApiError(
          data.error?.message ?? `Facebook API error (HTTP ${res.status})`,
          code,
          data.error?.error_subcode,
        );
      }
      return data;
    } catch (err) {
      if (err instanceof MetaApiError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new MetaApiError('Facebook request timed out');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async listAdAccounts(accessToken: string) {
    const body = await this.request('me/adaccounts', accessToken, {
      fields: 'id,name,currency,timezone_name,account_status',
      limit: 250,
    });
    return (body.data ?? []) as {
      id: string;
      name: string;
      currency?: string;
      timezone_name?: string;
      account_status?: number;
    }[];
  }

  async listCampaigns(adAccountId: string, accessToken: string) {
    const body = await this.request(`${adAccountId}/campaigns`, accessToken, {
      fields:
        'id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,created_time,updated_time,start_time,stop_time',
      limit: 250,
    });
    return (body.data ?? []) as Record<string, any>[];
  }

  async listAdSets(adAccountId: string, accessToken: string) {
    const body = await this.request(`${adAccountId}/adsets`, accessToken, {
      fields:
        'id,campaign_id,name,status,optimization_goal,billing_event,bid_strategy,daily_budget,start_time,end_time',
      limit: 250,
    });
    return (body.data ?? []) as Record<string, any>[];
  }

  async listAds(adAccountId: string, accessToken: string) {
    const body = await this.request(`${adAccountId}/ads`, accessToken, {
      fields: 'id,adset_id,campaign_id,name,status,effective_status,created_time',
      limit: 250,
    });
    return (body.data ?? []) as Record<string, any>[];
  }

  /**
   * Fetch daily insights (level=campaign, time_increment=1) — one response
   * row per campaign per day, pages followed until exhausted.
   */
  async fetchInsights(
    adAccountId: string,
    accessToken: string,
    since: string,
    until: string,
  ) {
    const rows: InsightRow[] = [];
    let nextPath: string | undefined;

    do {
      const body = nextPath
        ? await this.requestPath(nextPath, accessToken)
        : await this.request(`${adAccountId}/insights`, accessToken, {
            level: 'campaign',
            fields:
              'campaign_id,campaign_name,impressions,reach,clicks,ctr,cpc,cpm,spend,frequency,actions,action_values,purchase_roas',
            time_increment: 1,
            since,
            until,
            limit: 250,
          });
      for (const d of body.data ?? []) {
        rows.push(this.toInsightRow(d));
      }
      nextPath = body.paging?.next;
    } while (nextPath);

    return rows;
  }

  async requestPath(path: string, accessToken: string): Promise<any> {
    const url = new URL(path);
    url.searchParams.set('access_token', accessToken);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      const body: MetaErrorResponse = await res.json();
      if (!res.ok || body.error) {
        throw new MetaApiError(
          body.error?.message ?? `Facebook API error (HTTP ${res.status})`,
          body.error?.code,
        );
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  private toInsightRow(d: Record<string, any>): InsightRow {
    let purchases = 0;
    let purchaseValue = 0;
    for (const action of d.actions ?? []) {
      if (action.action_type === 'purchase') purchases += Number(action.value);
    }
    for (const action of d.action_values ?? []) {
      if (action.action_type === 'purchase') purchaseValue += Number(action.value);
    }
    return {
      campaignId: d.campaign_id,
      date: d.date_start,
      impressions: Number(d.impressions ?? 0),
      reach: Number(d.reach ?? 0),
      clicks: Number(d.clicks ?? 0),
      ctr: Number(d.ctr ?? 0),
      cpc: Number(d.cpc ?? 0),
      cpm: Number(d.cpm ?? 0),
      spend: Number(d.spend ?? 0),
      frequency: Number(d.frequency ?? 0),
      purchases,
      purchaseValue,
      roas: Number(d.purchase_roas ?? 0),
    };
  }

  async validateToken(accessToken: string) {
    const me = await this.request('me', accessToken, { fields: 'id,name' });
    if (!me.id) {
      throw new BadRequestException('Invalid access token: no user returned');
    }
    return me;
  }
}