import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { normalizePhone } from '../common/utils/phone-utils';
import { UpsertGatewayConfigDto } from './dto/upsert-gateway-config.dto';

@Controller('gateways')
export class GatewayConfigController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async findAll() {
    const gateways = await this.prisma.paymentGatewayConfig.findMany({
      where: { enabled: true },
      orderBy: { gateway: 'asc' },
    });
    return gateways.map((g) => ({
      id: g.id,
      gateway: g.gateway,
      enabled: g.enabled,
      mode: g.mode,
      phoneNumber: g.phoneNumber,
    }));
  }

  @Roles('superadmin', 'admin')
  @Get('admin')
  async findAllAdmin() {
    const gateways = await this.prisma.paymentGatewayConfig.findMany({
      orderBy: { gateway: 'asc' },
    });
    return gateways.map((g) => ({
      id: g.id,
      gateway: g.gateway,
      enabled: g.enabled,
      mode: g.mode,
      phoneNumber: g.phoneNumber,
      credentials: g.credentials,
    }));
  }

  @Roles('superadmin', 'admin')
  @Put(':gateway')
  async upsertOne(@Param('gateway') gateway: string, @Body() dto: UpsertGatewayConfigDto) {
    const phoneNumber = dto.phoneNumber ? normalizePhone(dto.phoneNumber) : null;
    return this.prisma.paymentGatewayConfig.upsert({
      where: { gateway },
      create: {
        gateway,
        enabled: dto.enabled ?? true,
        mode: dto.mode || 'personal',
        phoneNumber,
        credentials: dto.credentials || {},
      },
      update: {
        enabled: dto.enabled,
        mode: dto.mode,
        phoneNumber,
        credentials: dto.credentials,
      },
    });
  }
}
