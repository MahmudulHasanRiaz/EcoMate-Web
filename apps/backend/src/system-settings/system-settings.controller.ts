import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Controller('system-settings')
export class SystemSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async getAll() {
    const settings = await this.prisma.systemSetting.findMany();
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
    return map;
  }

  @Get('storage')
  async getStorageConfig() {
    return this.storage.getConfig();
  }

  @Post(':key')
  async set(@Param('key') key: string, @Body() body: { value: string }) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: body.value },
      update: { value: body.value },
    });
    return { key, value: body.value };
  }
}
