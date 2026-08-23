import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HrPaymentsService } from './hr-payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

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

  @Delete('payslips/:id/payments/:paymentId')
  deletePayment(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @CurrentUser() user?: any,
  ) {
    return this.hrPaymentsService.deletePayment(
      id,
      paymentId,
      user?.userId ?? user?.id,
    );
  }
}
