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
import { Roles } from '../common/decorators/roles.decorator';

@Controller('media')
export class MediaController {
  constructor(private readonly svc: MediaService) {}

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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Get(':id/attachments')
  getAttachments(@Param('id') id: string) {
    return this.svc.getAttachments(id);
  }

  @Patch(':id')
  @Roles('superadmin', 'admin', 'manager')
  updateMeta(@Param('id') id: string, @Body() dto: { alt?: string }) {
    return this.svc.updateMeta(id, dto);
  }

  @Delete(':id')
  @Roles('superadmin', 'admin', 'manager')
  remove(@Param('id') id: string, @Query('force') force?: string) {
    return this.svc.remove(id, force === 'true' || force === '1');
  }

  @Post(':id/attach')
  @Roles('superadmin', 'admin', 'manager')
  attach(
    @Param('id') id: string,
    @Body() dto: { entityType: string; entityId: string },
  ) {
    return this.svc.attach(id, dto.entityType, dto.entityId);
  }

  @Post(':id/detach')
  @Roles('superadmin', 'admin', 'manager')
  detach(
    @Param('id') id: string,
    @Body() dto: { entityType: string; entityId: string },
  ) {
    return this.svc.detach(id, dto.entityType, dto.entityId);
  }

  @Post('migrate-orphans')
  @Roles('superadmin', 'admin')
  migrate() {
    return this.svc.migrateOrphans();
  }
}
