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
import { basename, join, resolve } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { existsSync } from 'fs';
import { Public } from '../common/decorators/public.decorator';

const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024 * 1024;
const BACKUP_DOWNLOAD_COOKIE = 'ecomate_backup_download';

function maxUploadBytes(): number {
  const configured = Number(process.env.BACKUP_MAX_UPLOAD_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_UPLOAD_BYTES;
}

function uploadLimitLabel(bytes: number): string {
  return `${Math.ceil(bytes / 1024 / 1024 / 1024)}GB`;
}

async function backupWorkRoot(): Promise<string> {
  const root = resolve(process.env.BACKUP_WORK_DIR || tmpdir());
  await mkdir(root, { recursive: true });
  return root;
}

function setDownloadHeaders(
  reply: FastifyReply,
  filename: string,
  mimeType: string,
  size: bigint | null,
  range?: { start: number; end: number; total: bigint },
) {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  reply.header('Content-Type', mimeType);
  reply.header('Content-Disposition', `attachment; filename="${safeFilename}"`);
  reply.header('Cache-Control', 'private, no-store');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Accept-Ranges', 'bytes');
  if (range) {
    reply.code(206);
    reply.header(
      'Content-Range',
      `bytes ${range.start}-${range.end}/${range.total.toString()}`,
    );
  }
  if (size !== null) reply.header('Content-Length', size.toString());
}

@Controller('admin/backup')
@Roles('superadmin')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  /** Stream an uploaded multipart file to a temp dir, returning the tmp path + filename.
   *  Throws BadRequestException on invalid extension. Never loads file into memory. */
  private async streamUpload(
    req: FastifyRequest,
  ): Promise<{ tmpPath: string; filename: string }> {
    const uploadLimit = maxUploadBytes();
    const file = await req.file({
      limits: { fileSize: uploadLimit },
    });
    if (!file) throw new BadRequestException('File required');

    const filename = basename(file.filename);
    const lowerFilename = filename.toLowerCase();
    if (
      filename !== file.filename ||
      (!lowerFilename.endsWith('.sql.gz') &&
        !lowerFilename.endsWith('.tar.gz'))
    ) {
      file.file.resume();
      throw new BadRequestException('File must be .sql.gz or .tar.gz');
    }

    const tmpDir = join(
      await backupWorkRoot(),
      `backup-upload-${randomUUID()}`,
    );
    if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });
    const tmpPath = join(tmpDir, filename);

    // Stream directly to disk — never buffered in memory
    try {
      const dest = createWriteStream(tmpPath, { flags: 'wx' });
      await pipeline(file.file, dest);
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    if (file.file.truncated) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw new BadRequestException(
        `File exceeds the ${uploadLimitLabel(uploadLimit)} server limit`,
      );
    }

    const { size } = await stat(tmpPath);
    if (size === 0) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw new BadRequestException('Backup file is empty');
    }
    if (size > uploadLimit) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw new BadRequestException(
        `File exceeds the ${uploadLimitLabel(uploadLimit)} server limit`,
      );
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
  async download(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { stream, filename, mimeType, size, range } =
      await this.backup.downloadBackup(id, req.headers.range);
    setDownloadHeaders(reply, filename, mimeType, size, range);
    return reply.send(stream);
  }

  @Post(':id/download-ticket')
  async createDownloadTicket(
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const ticket = await this.backup.createDownloadTicket(id);
    const maxAgeSeconds = Math.max(
      1,
      Math.ceil((Date.parse(ticket.expiresAt) - Date.now()) / 1000),
    );
    reply.setCookie(BACKUP_DOWNLOAD_COOKIE, ticket.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: maxAgeSeconds,
      path: `/api/admin/backup-download/${encodeURIComponent(id)}`,
    });
    return { expiresAt: ticket.expiresAt };
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

/**
 * Browsers cannot stream an Axios blob to disk without buffering the entire
 * backup in RAM. A short-lived HttpOnly ticket cookie lets the browser's native
 * download manager stream directly to disk without leaking a credential in the
 * URL, Referer, browser history, or access logs.
 */
@Public()
@Controller('admin/backup-download')
export class BackupDownloadController {
  constructor(private readonly backup: BackupService) {}

  @Get(':id')
  async download(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const token = req.cookies?.[BACKUP_DOWNLOAD_COOKIE];
    if (!token) throw new BadRequestException('Download ticket required');
    const { stream, filename, mimeType, size, range } =
      await this.backup.downloadBackupWithTicket(
        id,
        token,
        req.headers.range,
      );
    reply.header('Referrer-Policy', 'no-referrer');
    setDownloadHeaders(reply, filename, mimeType, size, range);
    return reply.send(stream);
  }
}
