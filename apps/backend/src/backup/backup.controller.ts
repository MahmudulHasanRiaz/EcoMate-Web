import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Res, Req,
  BadRequestException,
  Put,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BackupService } from './backup.service';
import { CreateBackupDto } from './dto/create-backup.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('admin/backup')
@Roles('superadmin', 'admin')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  async list(@Query() query: any) {
    return this.backup.listBackups(query);
  }

  @Post()
  async create(@Body() dto: CreateBackupDto) {
    return this.backup.triggerManual(dto.scope);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.backup.getBackup(id);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() reply: FastifyReply) {
    const { stream, filename, mimeType } = await this.backup.downloadBackup(id);
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    reply.header('Content-Type', mimeType);
    reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
    return reply.send(stream);
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string) {
    return this.backup.restoreFromBackup(id);
  }

  @Post('restore/upload')
  async uploadRestore(@Req() req: FastifyRequest) {
    const file = await req.file();
    if (!file) throw new BadRequestException('File required');

    const buffer = await file.toBuffer();
    if (buffer.length > 5 * 1024 * 1024 * 1024) {
      throw new BadRequestException('File exceeds 5GB limit');
    }

    const name = file.filename;
    if (!name.endsWith('.sql.gz') && !name.endsWith('.tar.gz')) {
      throw new BadRequestException('File must be .sql.gz or .tar.gz');
    }

    return this.backup.restoreFromUpload(buffer, name);
  }

  @Patch(':id/lock')
  async toggleLock(@Param('id') id: string, @Body() body: { locked: boolean }) {
    await this.backup.toggleLock(id, body.locked);
    return { success: true };
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.backup.deleteBackup(id);
    return { success: true };
  }

  @Get('settings')
  async getSettings() {
    return this.backup.getSettings();
  }

  @Put('settings')
  async updateSettings(@Body() body: Record<string, string>) {
    await this.backup.updateSettings(body);
    return { success: true };
  }
}