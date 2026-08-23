import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { HrLedgersService } from './hr-ledgers.service';
import { CreateEarningDto } from './dto/create-earning.dto';
import { CreateDeductionDto } from './dto/create-deduction.dto';
import { LedgerStatus } from '@prisma/client';

@Controller('hr')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('manage_payroll', 'manage_employees')
@RequiresFeature('admin_hr')
export class HrLedgersController {
  constructor(private readonly hrLedgersService: HrLedgersService) {}

  @Post('earnings')
  createEarning(
    @Body() dto: CreateEarningDto,
    @CurrentUser() user?: any,
  ) {
    return this.hrLedgersService.createEarning(
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Get('earnings')
  findEarnings(
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: LedgerStatus,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.hrLedgersService.findEarnings(
      { employeeId, status },
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Post('earnings/:id/approve')
  approveEarning(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ) {
    return this.hrLedgersService.approveEarning(id, user?.userId ?? user?.id);
  }

  @Post('deductions')
  createDeduction(
    @Body() dto: CreateDeductionDto,
    @CurrentUser() user?: any,
  ) {
    return this.hrLedgersService.createDeduction(
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Get('deductions')
  findDeductions(
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: LedgerStatus,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.hrLedgersService.findDeductions(
      { employeeId, status },
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Post('deductions/:id/approve')
  approveDeduction(
    @Param('id') id: string,
    @CurrentUser() user?: any,
  ) {
    return this.hrLedgersService.approveDeduction(
      id,
      user?.userId ?? user?.id,
    );
  }
}
