import { Controller, Get, Post, Param } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CodMismatchService } from './cod-mismatch.service';

@Controller('orders')
export class CodMismatchController {
  constructor(private readonly svc: CodMismatchService) {}

  @Permissions('view_cod_mismatch')
  @RequiresFeature('admin_orders')
  @Get(':id/cod-alerts')
  list(@Param('id') id: string) {
    return this.svc.listForOrder(id);
  }

  @Permissions('resolve_cod_mismatch')
  @RequiresFeature('admin_orders')
  @Post(':id/cod-alerts/:alertId/resolve')
  resolve(
    @Param('id') orderId: string,
    @Param('alertId') alertId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.resolve(alertId, user.userId, orderId);
  }
}
