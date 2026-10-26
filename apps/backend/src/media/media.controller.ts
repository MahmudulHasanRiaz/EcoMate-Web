import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Query,
  Body,
} from '@nestjs/common';
import { MediaService } from './media.service';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('media')
@RequiresFeature('admin_media')
export class MediaController {
  constructor(private readonly svc: MediaService) {}

  @Permissions('view_media')
  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('attached') attached?: string,
  ) {
    return this.svc.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      search,
      type,
      attached,
    });
  }

  @Permissions('view_media')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Permissions('view_media')
  @Get(':id/attachments')
  getAttachments(@Param('id') id: string) {
    return this.svc.getAttachments(id);
  }

  @Patch(':id')
  @Permissions('edit_media')
  updateMeta(@Param('id') id: string, @Body() dto: { alt?: string }) {
    return this.svc.updateMeta(id, dto);
  }

  @Delete(':id')
  @Permissions('delete_media')
  remove(@Param('id') id: string, @Query('force') force?: string) {
    return this.svc.remove(id, force === 'true' || force === '1');
  }

  @Post(':id/attach')
  @Permissions('edit_media')
  attach(
    @Param('id') id: string,
    @Body() dto: { entityType: string; entityId: string },
  ) {
    return this.svc.attach(id, dto.entityType, dto.entityId);
  }

  @Post(':id/detach')
  @Permissions('edit_media')
  detach(
    @Param('id') id: string,
    @Body() dto: { entityType: string; entityId: string },
  ) {
    return this.svc.detach(id, dto.entityType, dto.entityId);
  }

  @Post('bulk-delete')
  @Permissions('delete_media')
  bulkRemove(@Body() dto: { ids: string[]; force?: boolean }) {
    return this.svc.bulkRemove(dto.ids, dto.force ?? false);
  }

  @Post('migrate-orphans')
  @Permissions('maintain_media')
  migrate() {
    return this.svc.migrateOrphans();
  }

  @Post(':id/reprocess')
  @Permissions('maintain_media')
  reprocess(@Param('id') id: string) {
    return this.svc.reprocess(id);
  }

  @Post('reprocess-failed')
  @Permissions('maintain_media')
  reprocessFailed(@Body() dto: { batchSize?: number }) {
    return this.svc.reprocessFailed(dto.batchSize);
  }

  @Post('backfill')
  @Permissions('maintain_media')
  backfill(@Body() dto: { batchSize?: number; max?: number }) {
    return this.svc.backfill(dto);
  }

  @Post('recover-stuck')
  @Permissions('maintain_media')
  recoverStuck(@Body() dto: { sinceMinutes?: number }) {
    return this.svc.recoverStuck(dto.sinceMinutes);
  }
}
