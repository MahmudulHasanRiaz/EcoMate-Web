import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { Public } from '../common/decorators/public.decorator';
import { BD_DISTRICTS } from './data/bd-districts';

const CHARGES_CACHE_KEY = 'delivery_areas:district_charges';
const CHARGES_CACHE_TTL = 600_000;

@Controller('delivery-areas')
export class DeliveryAreasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  @Public()
  @Get('districts')
  async getDistricts() {
    const charges = await this.getCachedCharges();

    return BD_DISTRICTS.map((d) => ({
      name: d.name,
      nameBn: d.nameBn,
      charge: charges[d.name] ?? null,
      thanaCount: d.thanas.length,
    })).sort((a, b) => (a.nameBn ?? a.name).localeCompare(b.nameBn ?? b.name, 'bn'));
  }

  private async getCachedCharges(): Promise<Record<string, number>> {
    const cached =
      await this.cache.get<Record<string, number>>(CHARGES_CACHE_KEY);
    if (cached) return cached;

    try {
      const chargesRaw = await this.prisma.systemSetting.findUnique({
        where: { key: 'district_charges' },
      });
      const charges: Record<string, number> = {};
      if (chargesRaw) {
        Object.assign(charges, JSON.parse(chargesRaw.value));
      }
      await this.cache.set(CHARGES_CACHE_KEY, charges, CHARGES_CACHE_TTL);
      return charges;
    } catch {
      return {};
    }
  }

  @Public()
  @Get('districts/:district/thanas')
  getThanas(@Param('district') district: string) {
    const found = BD_DISTRICTS.find(
      (d) =>
        d.name.toLowerCase() === decodeURIComponent(district).toLowerCase(),
    );
    if (!found) throw new NotFoundException('District not found');
    return found.thanas
      .map((t) => ({ name: t.name, nameBn: t.nameBn }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
