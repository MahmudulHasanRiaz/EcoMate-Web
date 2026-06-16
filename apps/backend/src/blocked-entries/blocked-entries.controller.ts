import { Controller, Get, Post, Param, Query, Body, Req } from '@nestjs/common';
import { BlockedEntriesService } from './blocked-entries.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('blocked-entries')
export class BlockedEntriesController {
  constructor(private readonly svc: BlockedEntriesService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get()
  async findAll(@Query('type') type?: string, @Query('search') search?: string) {
    return this.svc.findAll(type, search);
  }

  @Roles('superadmin', 'admin')
  @Post()
  async create(@Body() dto: { type: 'ip' | 'phone'; value: string; reason?: string; blockType?: string }, @Req() req: any) {
    return this.svc.create({ ...dto, blockedBy: req.user?.username || 'admin' });
  }

  @Roles('superadmin', 'admin')
  @Post(':type/:id/unblock')
  async unblock(@Param('type') type: string, @Param('id') id: string) {
    await this.svc.unblock(type, id);
    return { success: true };
  }

  @Roles('superadmin', 'admin')
  @Post(':type/:id/whitelist')
  async toggleWhitelist(@Param('type') type: string, @Param('id') id: string) {
    await this.svc.toggleWhitelist(type, id);
    return { success: true };
  }
}
