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
import { createWriteStream } from 'fs';
import { mkdir, stat, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { existsSync } from 'fs';

@Controller('admin/backup')
@Roles('superadmin', 'admin')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  /** Stream an uploaded multipart file to a temp dir, returning the tmp path + filename.
   *  Throws BadRequestException on invalid extension. Never loads file into memory. */
  private async streamUpload(
    req: FastifyRequest,
  ): Promise<{ tmpPath: string; filename: string }> {
    const file = await req.file();
    if (!file) throw new BadRequestException('File required');

    const filename = file.filename;
    if (!filename.endsWith('.sql.gz') && !filename.endsWith('.tar.gz')) {
      throw new BadRequestException('File must be .sql.gz or .tar.gz');
    }

    const tmpDir = join(tmpdir(), `backup-upload-${randomUUID()}`);
    if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, filename);

    // Stream directly to disk — never buffered in memory
    const dest = createWriteStream(tmpPath);
    await pipeline(file.file, dest);

    // Check size after streaming (can't check before with streaming)
    const { size } = await stat(tmpPath);
    const MAX_BYTES = 5n * 1024n * 1024n * 1024n; // 5GB
    if (BigInt(size) > MAX_BYTES) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw new BadRequestException('File exceeds 5GB limit');
    }

    return { tmpPath, filename };
  }

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
    const { tmpPath, filename } = await this.streamUpload(req);
    return this.backup.restoreFromUpload(tmpPath, filename);
  }

  @Post('upload')
  async uploadOnly(@Req() req: FastifyRequest) {
    const { tmpPath, filename } = await this.streamUpload(req);
    return this.backup.uploadOnly(tmpPath, filename);
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