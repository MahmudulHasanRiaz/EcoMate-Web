import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { BD_DISTRICTS } from './data/bd-districts';

@Controller('delivery-areas')
export class DeliveryAreasController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('districts')
  async getDistricts() {
    const chargesRaw = await this.prisma.systemSetting.findUnique({
      where: { key: 'district_charges' },
    });
    const charges: Record<string, number> = {};
    if (chargesRaw) {
      try {
        Object.assign(charges, JSON.parse(chargesRaw.value));
      } catch {}
    }

    return BD_DISTRICTS.map((d) => ({
      name: d.name,
      nameBn: d.nameBn,
      charge: charges[d.name] ?? null,
      thanaCount: d.thanas.length,
    }));
  }

  @Public()
  @Get('districts/:district/thanas')
  getThanas(@Param('district') district: string) {
    const found = BD_DISTRICTS.find(
      (d) =>
        d.name.toLowerCase() === decodeURIComponent(district).toLowerCase(),
    );
    if (!found) throw new NotFoundException('District not found');
    return found.thanas.map((t) => ({ name: t.name, nameBn: t.nameBn }));
  }
}
