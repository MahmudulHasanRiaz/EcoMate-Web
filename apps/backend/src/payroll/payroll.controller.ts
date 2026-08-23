import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { SetSalaryStructureDto } from './dto/set-salary-structure.dto';
import { GeneratePayslipDto } from './dto/generate-payslip.dto';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';

@Controller('payroll')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('view_hr')
@RequiresFeature('admin_payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('salary-structure')
  @PermissionsAny('manage_payroll')
  setSalaryStructure(@Body() dto: SetSalaryStructureDto) {
    return this.payrollService.setSalaryStructure(dto);
  }

  @Get('salary-structure/:employeeId')
  getSalaryStructure(@Param('employeeId') employeeId: string) {
    return this.payrollService.getSalaryStructure(employeeId);
  }

  @Post('payslips/generate')
  @PermissionsAny('manage_payroll')
  generatePayslip(@Body() dto: GeneratePayslipDto) {
    return this.payrollService.generatePayslip(
      dto.employeeId,
      dto.periodStart,
      dto.periodEnd,
    );
  }

  @Get('payslips')
  findAllPayslips(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('periodKey') periodKey?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.payrollService.findAllPayslips(
      page ? parseInt(page) : 1,
      perPage ? parseInt(perPage) : 20,
      periodKey,
      employeeId,
    );
  }

  @Get('payslips/:id')
  findPayslip(@Param('id') id: string) {
    return this.payrollService.findPayslip(id);
  }

  @Patch('payslips/:id/approve')
  @PermissionsAny('manage_payroll')
  approvePayslip(@Param('id') id: string) {
    return this.payrollService.approvePayslip(id);
  }

  @Patch('payslips/:id/status')
  @PermissionsAny('manage_payroll')
  setPayslipStatus(
    @Param('id') id: string,
    @Body() dto: { status: 'reviewed' | 'approved' | 'cancelled' },
  ) {
    return this.payrollService.setStatus(id, dto.status);
  }
}
