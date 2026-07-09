import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
} from '@nestjs/common';
import { PackingService } from './packing.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HoldOrderDto, PackingQueueQueryDto } from './dto/packing.dto';

@Controller('packing')
export class PackingController {
  constructor(private readonly svc: PackingService) {}

  @Roles('packing_assistant', 'admin', 'superadmin')
  @Get('queue')
  async getQueue(@Query() query: PackingQueueQueryDto) {
    return this.svc.getQueue(query.search);
  }

  @Roles('packing_assistant', 'admin', 'superadmin')
  @Get('queue/:id')
  async openOrder(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.openOrder(id, user.userId);
  }

  @Roles('packing_assistant', 'admin', 'superadmin')
  @Post('queue/:id/done')
  async markDone(
    @Param('id') id: string,
    @Body('verificationMode') verificationMode: string,
    @CurrentUser() user: any,
  ) {
    return this.svc.markDone(id, user.userId, verificationMode);
  }

  @Roles('packing_assistant', 'admin', 'superadmin')
  @Post('queue/:id/hold')
  async markHold(
    @Param('id') id: string,
    @Body() dto: HoldOrderDto,
    @CurrentUser() user: any,
  ) {
    return this.svc.markHold(id, user.userId, dto.reason, dto.notes);
  }
  @Roles('packing_assistant', 'admin', 'superadmin')
  @Delete('queue/:id/lock')
  async releaseLock(@Param('id') id: string, @CurrentUser() user: any) {
    return this.svc.releaseLock(id, user.userId);
  }
  @Roles('admin', 'superadmin')
  @Get('locks')
  async getActiveLocks() {
    return this.svc.getActiveLocks();
  }

  @Roles('packing_assistant', 'admin', 'superadmin')
  @Get('stats')
  async getStats(@CurrentUser() user: any, @Query('all') all?: string) {
    if (all && (user.role === 'admin' || user.role === 'superadmin')) {
      return this.svc.getStats();
    }
    return this.svc.getStats(user.userId);
  }

  @Roles('packing_assistant', 'admin', 'superadmin')
  @Get('check/:code')
  async checkOrderStatus(@Param('code') code: string) {
    return this.svc.checkOrderStatus(code);
  }

  @Roles('admin', 'superadmin')
  @Get('history')
  async getHistory(@Query('packerId') packerId?: string) {
    return this.svc.getHistory(packerId);
  }
}
