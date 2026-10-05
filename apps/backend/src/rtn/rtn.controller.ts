import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { RtnService, RtnActor } from './rtn.service';
import { CreateReturnOrderDto } from './dto/create-return-order.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

/**
 * RTN (return order) endpoints. Explicit domain commands — the scanner and
 * the admin UI both go through these; nothing calls generic order CRUD for
 * return semantics.
 */
@Controller('rtn')
export class RtnController {
  constructor(private readonly rtnService: RtnService) {}

  private actor(user: { userId: string; email: string }): RtnActor {
    return { userId: user.userId, email: user.email };
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_orders')
  @Get('order/:orderId')
  findForOriginalOrder(@Param('orderId') orderId: string) {
    return this.rtnService.findForOriginalOrder(orderId);
  }

  /**
   * Every return order ever raised against an original (newest first). An
   * original may accumulate several RTNs over its life, so the detail page
   * needs the full list, not just the open one.
   */
  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_orders')
  @Get('order/:orderId/all')
  findAllForOriginalOrder(@Param('orderId') orderId: string) {
    return this.rtnService.findAllForOriginalOrder(orderId);
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_orders')
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.rtnService.findById(id);
  }

  /**
   * Create the RTN return order from a Partial original order.
   * Body: { items: [{ orderItemId, quantity }] }.
   */
  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_orders')
  @Post('from-order/:orderId')
  createFromPartialOrder(
    @Param('orderId') orderId: string,
    @Body() dto: CreateReturnOrderDto,
    @CurrentUser() user: { userId: string; email: string },
  ) {
    return this.rtnService.createFromPartialOrder(orderId, dto, this.actor(user));
  }

  /**
   * Finalize the return for a dispatch (scanner "Dispatch → Return" purpose
   * and admin re-scan entry point). Full return → original Returned;
   * Partial return → RTN Returned + exact stock restoration.
   */
  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_orders')
  @Post('dispatch/:dispatchId/finalize-return')
  finalizeDispatchReturn(
    @Param('dispatchId') dispatchId: string,
    @CurrentUser() user: { userId: string; email: string },
  ) {
    return this.rtnService.finalizeDispatchReturn(dispatchId, this.actor(user));
  }
}
