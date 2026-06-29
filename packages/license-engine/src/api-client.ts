import type { LicenseInfo } from './types';

export class ApiClient {
  private baseUrl: string;
  private defaultApiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultApiKey = apiKey;
  }

  async verify(licenseKey: string, domain?: string, apiKey?: string): Promise<LicenseInfo> {
    const key = apiKey || this.defaultApiKey;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['X-API-Key'] = key;

    const res = await fetch(`${this.baseUrl}/licenses/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ licenseKey, domain }),
      signal: AbortSignal.timeout(10_000),
    });

    return res.json() as Promise<LicenseInfo>;
  }

  async checkIn(licenseKey: string, domain?: string, apiKey?: string): Promise<LicenseInfo> {
    const key = apiKey || this.defaultApiKey;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['X-API-Key'] = key;

    const res = await fetch(`${this.baseUrl}/licenses/${encodeURIComponent(licenseKey)}/check-in`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(10_000),
    });

    return res.json() as Promise<LicenseInfo>;
  }
}
