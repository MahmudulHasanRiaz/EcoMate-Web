import { Controller, Get, Post, Body, Param, Put, Delete, Query } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('accounts')
@Roles('superadmin', 'admin')
@RequiresFeature('admin_accounting')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  create(@Body() dto: CreateAccountDto, @CurrentUser() user?: any) {
    return this.accountsService.create(dto, user?.sub);
  }

  @Get()
  findAll(@Query('type') type?: string) {
    return this.accountsService.findAll(type);
  }

  @Get('tree')
  getChartOfAccounts() {
    return this.accountsService.getChartOfAccounts();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.accountsService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accountsService.remove(id);
  }
}
