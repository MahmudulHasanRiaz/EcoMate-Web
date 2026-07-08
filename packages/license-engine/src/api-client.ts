import { getMachineId } from './machine-id';

export class ApiClient {
  private baseUrl: string;
  private defaultApiKey?: string;
  private machineId: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultApiKey = apiKey;
    this.machineId = getMachineId();
  }

  async verify(licenseKey: string, domain?: string, apiKey?: string): Promise<any> {
    const key = apiKey || this.defaultApiKey;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['X-API-Key'] = key;
    const res = await fetch(`${this.baseUrl}/licenses/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ licenseKey, domain, machineId: this.machineId }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.json();
  }

  async checkIn(licenseKey: string, domain?: string, apiKey?: string): Promise<any> {
    const key = apiKey || this.defaultApiKey;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['X-API-Key'] = key;
    const res = await fetch(`${this.baseUrl}/licenses/${encodeURIComponent(licenseKey)}/check-in`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ domain, machineId: this.machineId }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.json();
  }
}
