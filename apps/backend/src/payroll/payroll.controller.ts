import { Controller, Get, Post, Body, Param, Patch, Query } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { SetSalaryStructureDto } from './dto/set-salary-structure.dto';
import { GeneratePayslipDto } from './dto/generate-payslip.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('payroll')
@Roles('superadmin', 'admin')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('salary-structure')
  setSalaryStructure(@Body() dto: SetSalaryStructureDto) {
    return this.payrollService.setSalaryStructure(dto);
  }

  @Get('salary-structure/:employeeId')
  getSalaryStructure(@Param('employeeId') employeeId: string) {
    return this.payrollService.getSalaryStructure(employeeId);
  }

  @Post('payslips/generate')
  generatePayslip(@Body() dto: GeneratePayslipDto) {
    return this.payrollService.generatePayslip(dto.employeeId, dto.periodStart as unknown as string, dto.periodEnd as unknown as string);
  }

  @Get('payslips')
  findAllPayslips(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.payrollService.findAllPayslips(
      page ? parseInt(page) : 1,
      perPage ? parseInt(perPage) : 20,
    );
  }

  @Get('payslips/:id')
  findPayslip(@Param('id') id: string) {
    return this.payrollService.findPayslip(id);
  }

  @Patch('payslips/:id/approve')
  approvePayslip(@Param('id') id: string) {
    return this.payrollService.approvePayslip(id);
  }
}
