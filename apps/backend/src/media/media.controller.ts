import { Controller, Get, Post, Delete, Param, Query, Body } from '@nestjs/common';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly svc: MediaService) {}

  @Get()
  findAll(
    @Query('page') page?: string, @Query('perPage') perPage?: string,
    @Query('search') search?: string, @Query('type') type?: string,
    @Query('attached') attached?: string,
  ) {
    return this.svc.findAll({ page: page ? parseInt(page) : undefined, perPage: perPage ? parseInt(perPage) : undefined, search, type, attached });
  }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Post(':id/attach')
  attach(@Param('id') id: string, @Body() dto: { entityType: string; entityId: string }) {
    return this.svc.attach(id, dto.entityType, dto.entityId);
  }

  @Post(':id/detach')
  detach(@Param('id') id: string, @Body() dto: { entityType: string; entityId: string }) {
    return this.svc.detach(id, dto.entityType, dto.entityId);
  }
}
