import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { CreateDispatchDto } from './dto/create-dispatch.dto';
import { DispatchQueryDto } from './dto/dispatch-query.dto';
import { SyncDispatchStatusDto } from './dto/sync-dispatch-status.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DispatchCancelService } from '../dispatch-cancel/dispatch-cancel.service';

@Controller('dispatch')
export class DispatchController {
  constructor(
    private readonly dispatchService: DispatchService,
    private readonly dispatchCancel: DispatchCancelService,
  ) {}

  @Roles('superadmin', 'admin', 'employee')
  @Get()
  findAll(@Query() query: DispatchQueryDto) {
    return this.dispatchService.findAll(query);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get('metrics')
  getMetrics() {
    return this.dispatchService.getMetrics();
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get('flagged')
  findFlagged() {
    return this.dispatchService.findFlagged();
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post(':id/resolve-flagged')
  resolveFlagged(
    @Param('id') id: string,
    @Body('action') action: 'accept' | 'accessories' | 'cancel',
  ) {
    return this.dispatchService.resolveFlagged(id, action);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dispatchService.findOne(id);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post('cancel-preview')
  cancelPreview(@Body('orderId') orderId: string) {
    return this.dispatchService.getCancelPreview(orderId);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post('sync-status')
  syncStatusFromCourier(
    @Body() dto: SyncDispatchStatusDto,
    @CurrentUser() user: { email: string },
  ) {
    return this.dispatchService.syncStatusFromCourier(
      dto.ids,
      user?.email || 'admin',
    );
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post()
  create(@Body() dto: CreateDispatchDto) {
    return this.dispatchService.create(dto);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser() user: { email: string },
    @Body('performedBy') performedBy?: string,
  ) {
    return this.dispatchService.updateStatus(id, status, performedBy || user.email);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post(':id/confirm-panel-cancel')
  confirmPanelCancel(
    @Param('id') id: string,
    @CurrentUser() user: { email?: string; userId?: string },
  ) {
    return this.dispatchCancel.confirmManualPanelCancel(
      id,
      user?.email || user?.userId || 'staff',
    );
  }

  @Delete(':id')
  @Permissions('manage_dispatch_dispatch')
  remove(@Param('id') id: string) {
    return this.dispatchService.remove(id);
  }
}
