import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('employees')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('view_hr')
@RequiresFeature('admin_employees')
export class EmployeeBankAccountsController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get(':id/bank-accounts')
  list(@Param('id') id: string) {
    return this.employeesService.listBankAccounts(id);
  }

  @Post(':id/bank-accounts')
  @PermissionsAny('manage_employees')
  create(
    @Param('id') id: string,
    @Body() dto: CreateBankAccountDto,
    @CurrentUser() user?: any,
  ) {
    return this.employeesService.createBankAccount(
      id,
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Patch('bank-accounts/:accountId')
  @PermissionsAny('manage_employees')
  update(
    @Param('accountId') accountId: string,
    @Body() dto: UpdateBankAccountDto,
    @CurrentUser() user?: any,
  ) {
    return this.employeesService.updateBankAccount(
      accountId,
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Post('bank-accounts/:accountId/primary')
  @PermissionsAny('manage_employees')
  setPrimary(
    @Param('accountId') accountId: string,
    @CurrentUser() user?: any,
  ) {
    return this.employeesService.setPrimaryBankAccount(
      accountId,
      user?.userId ?? user?.id,
    );
  }

  @Delete('bank-accounts/:accountId')
  @PermissionsAny('manage_employees')
  remove(@Param('accountId') accountId: string) {
    return this.employeesService.deleteBankAccount(accountId);
  }
}