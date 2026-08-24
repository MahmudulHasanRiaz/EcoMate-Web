import {
  Controller,
  Get,
  Post,
  Body,
  Param,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HrPaymentsService } from './hr-payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';

@Controller('payroll')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('manage_payroll')
@RequiresFeature('admin_payroll')
export class HrPaymentsController {
  constructor(private readonly hrPaymentsService: HrPaymentsService) {}

  @Post('payslips/:id/payments')
  createPayment(
    @Param('id') id: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user?: any,
  ) {
    return this.hrPaymentsService.createPayment(
      { ...dto, payslipId: id },
      user?.userId ?? user?.id,
    );
  }

  @Get('payslips/:id/payments')
  findPayments(@Param('id') id: string) {
    return this.hrPaymentsService.findPayments(id);
  }

  // G-20: void (auditable) replaces hard DELETE. reason is required.
  @Post('payslips/:id/payments/:paymentId/void')
  voidPayment(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: VoidPaymentDto,
    @CurrentUser() user?: any,
  ) {
    return this.hrPaymentsService.voidPayment(
      id,
      paymentId,
      dto.reason,
      user?.userId ?? user?.id,
    );
  }
}
