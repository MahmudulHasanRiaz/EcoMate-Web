import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('gateways')
export class GatewayConfigController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll() { return this.prisma.paymentGatewayConfig.findMany({ orderBy: { gateway: 'asc' } }); }

  @Put(':gateway')
  async upsertOne(@Param('gateway') gateway: string, @Body() dto: any) {
    return this.prisma.paymentGatewayConfig.upsert({
      where: { gateway },
      create: {
        gateway,
        enabled: dto.enabled ?? true,
        mode: dto.mode || 'personal',
        phoneNumber: dto.phoneNumber || null,
        credentials: dto.credentials || {},
      },
      update: {
        enabled: dto.enabled,
        mode: dto.mode,
        phoneNumber: dto.phoneNumber,
        credentials: dto.credentials,
      },
    });
  }
}
