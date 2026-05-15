import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CourierService {
  private readonly logger = new Logger(CourierService.name);
  private readonly BASE_URL = 'https://dash.hoorin.com/api/courier';

  constructor(private readonly prisma: PrismaService) {}

  private async getApiKey(): Promise<string | null> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'courier_hoorin_api_key' } });
    return setting?.value || null;
  }

  async search(phoneNumber: string) {
    const apiKey = await this.getApiKey();
    if (!apiKey) return { error: 'Hoorin API key not configured' };

    try {
      const url = `${this.BASE_URL}/api?apiKey=${encodeURIComponent(apiKey)}&searchTerm=${encodeURIComponent(phoneNumber)}`;
      const res = await fetch(url);
      if (!res.ok) return { error: `Hoorin API error: ${res.status}` };
      return await res.json();
    } catch (e: any) {
      this.logger.error('Courier API failed', e.message);
      return { error: 'Failed to fetch courier data' };
    }
  }

  async summary(phoneNumber: string) {
    const apiKey = await this.getApiKey();
    if (!apiKey) return { error: 'Hoorin API key not configured' };

    try {
      const url = `${this.BASE_URL}/sheet?apiKey=${encodeURIComponent(apiKey)}&searchTerm=${encodeURIComponent(phoneNumber)}`;
      const res = await fetch(url);
      if (!res.ok) return { error: `Hoorin API error: ${res.status}` };
      return await res.json();
    } catch (e: any) {
      this.logger.error('Courier summary API failed', e.message);
      return { error: 'Failed to fetch courier summary' };
    }
  }
}
