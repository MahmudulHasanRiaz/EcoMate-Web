import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CustomerCreditService } from './customer-credit.service';
import { ApplyCreditDto } from './dto/apply-credit.dto';

/**
 * Task 8 — customer credit endpoints.
 *
 * GET /customers/:id/credit lives here (not on CustomersController) so the
 * credit surface stays in its own module; the admin_customers feature gate
 * matches the customers controller's class-level gate.
 *
 * POST /orders/:id/apply-credit is deliberately WITHOUT @Permissions: applying
 * credit is staff-initiated BY design ("offer apply credit") — any staff role
 * may apply (record action, D3), and the actor is recorded in
 * payment.recordedBy + entry.createdBy. approve_payments stays reserved for
 * verifying other staff's entries.
 */
@Controller()
export class CustomerCreditController {
  constructor(private readonly svc: CustomerCreditService) {}

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_customers')
  @Get('customers/:id/credit')
  getCredit(@Param('id') id: string) {
    return this.svc.getProfile(id);
  }

  @Roles('superadmin', 'admin', 'employee')
  @RequiresFeature('admin_orders')
  @Post('orders/:id/apply-credit')
  applyCredit(
    @Param('id') id: string,
    @Body() dto: ApplyCreditDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.svc.applyCredit(id, dto.amount, user.userId);
  }
}
