import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
export class CourierService {
  private readonly logger = new Logger(CourierService.name);
  private readonly BASE_URL = 'https://dash.hoorin.com/api/courier';
  private readonly API_KEY_CACHE_TTL = 300_000;
  private readonly RESULT_CACHE_TTL = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private async getApiKey(): Promise<string> {
    const cached = await this.cache.get<string>('courier:hoorin:api_key');
    if (cached) return cached;

    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'courier_hoorin_api_key' },
    });
    if (!setting?.value) {
      throw new HttpException(
        'Hoorin API key not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.cache.set(
      'courier:hoorin:api_key',
      setting.value,
      this.API_KEY_CACHE_TTL,
    );
    return setting.value;
  }

  async search(phoneNumber: string) {
    const cacheKey = `courier:search:${phoneNumber}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const apiKey = await this.getApiKey();
    try {
      const url = `${this.BASE_URL}/api?apiKey=${encodeURIComponent(apiKey)}&searchTerm=${encodeURIComponent(phoneNumber)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new HttpException(
          `Hoorin API error: ${res.status}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      const data = await res.json();
      await this.cache.set(cacheKey, data, this.RESULT_CACHE_TTL);
      return data;
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      this.logger.error('Courier API failed', e.message);
      throw new HttpException(
        'Failed to fetch courier data',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async summary(phoneNumber: string) {
    const cacheKey = `courier:summary:${phoneNumber}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const apiKey = await this.getApiKey();
    try {
      const url = `${this.BASE_URL}/sheet?apiKey=${encodeURIComponent(apiKey)}&searchTerm=${encodeURIComponent(phoneNumber)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new HttpException(
          `Hoorin API error: ${res.status}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      const data = await res.json();
      await this.cache.set(cacheKey, data, this.RESULT_CACHE_TTL);
      return data;
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      this.logger.error('Courier summary API failed', e.message);
      throw new HttpException(
        'Failed to fetch courier summary',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
