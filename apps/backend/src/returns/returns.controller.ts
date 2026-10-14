import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ReturnsService } from './returns.service';
import {
  CreateReturnDto,
  LinkRefundDto,
  ListReturnsQueryDto,
  MarkReceivedDto,
} from './dto/return.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';

/**
 * Returns endpoints (Task 6, Fix 13). Guards mirror the rtn module:
 * order-adjacent staff surface — no new feature flag (admin_orders).
 * Admin Returns/Exchanges list UI ships in T7; this controller is the
 * backend contract it builds on.
 */
@Controller('returns')
@RequiresFeature('admin_orders')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Roles('superadmin', 'admin', 'employee')
  @Get()
  list(
    @Query('orderId') orderId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const q: ListReturnsQueryDto = { orderId, status, type, source, search };
    return this.returns.list({
      ...q,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.returns.get(id);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post()
  create(
    @Body() dto: CreateReturnDto,
    @CurrentUser() user?: { userId: string; email: string },
  ) {
    return this.returns.create(dto, user?.email);
  }

  /**
   * Staff-confirmed receipt: RECEIVED → item-level restore → RESTOCKED →
   * dispatch RETURNED (FULL) / PARTIAL (PARTIAL). The order is untouched.
   */
  @Roles('superadmin', 'admin', 'employee')
  @Post(':id/mark-received')
  markReceived(
    @Param('id') id: string,
    @Body() dto: MarkReceivedDto,
    @CurrentUser() user?: { userId: string; email: string },
  ) {
    return this.returns.markReceived(id, { items: dto?.items, performedBy: user?.email });
  }

  @Roles('superadmin', 'admin', 'employee')
  @Put(':id/refund')
  linkRefund(@Param('id') id: string, @Body() dto: LinkRefundDto) {
    return this.returns.linkRefund(id, dto);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.returns.close(id);
  }
}
