import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ExchangeService, ExchangeActor } from './exchange.service';
import { CreateExchangeOrderDto } from './dto/create-exchange-order.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

/**
 * Exchange Order endpoints. An independent business flow — NOT part of the
 * Partial/Split return workflow (requirements §1).
 */
@Controller('exchange')
export class ExchangeController {
  constructor(private readonly exchangeService: ExchangeService) {}

  private actor(user: { userId: string; email: string }): ExchangeActor {
    return { userId: user.userId, email: user.email };
  }

  /**
   * What the customer already paid on the original, minus whatever sibling
   * exchanges have consumed. Drives the live settlement preview in the UI (§4).
   */
  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_orders')
  @Get('settlement-preview/:orderId')
  settlementPreview(@Param('orderId') orderId: string) {
    return this.exchangeService.getSettlementPreview(orderId);
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_orders')
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.exchangeService.findById(id);
  }

  /**
   * Create an Exchange Order from an existing order. Any sale order qualifies,
   * including one already marked Delivered (§1).
   */
  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_orders')
  @Post('from-order/:orderId')
  createFromOrder(
    @Param('orderId') orderId: string,
    @Body() dto: CreateExchangeOrderDto,
    @CurrentUser() user: { userId: string; email: string },
  ) {
    return this.exchangeService.createFromOrder(orderId, dto, this.actor(user));
  }
}