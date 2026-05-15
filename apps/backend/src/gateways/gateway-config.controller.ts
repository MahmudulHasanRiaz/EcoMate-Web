import { Controller, Get, Put, Body } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('gateways')
export class GatewayConfigController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll() { return this.prisma.paymentGatewayConfig.findMany({ orderBy: { gateway: 'asc' } }); }

  @Put(':gateway')
  async upsert(@Body() dto: Record<string, any>) {
    return this.prisma.paymentGatewayConfig.upsert({
      where: { gateway: dto.gateway },
      create: {
        gateway: dto.gateway,
        enabled: dto.enabled ?? false,
        mode: dto.mode || 'personal',
        phoneNumber: dto.phoneNumber || null,
        credentials: dto.credentials || {},
      },
      update: {
        enabled: dto.enabled ?? undefined,
        mode: dto.mode ?? undefined,
        phoneNumber: dto.phoneNumber ?? undefined,
        credentials: dto.credentials ?? undefined,
      },
    });
  }
}
