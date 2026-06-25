import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { OpeningBalancesService } from './opening-balances.service';
import { SetOpeningBalanceDto } from './dto/set-opening-balance.dto';
import { AccountingEnabledGuard } from '../accounting/accounting-enabled.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Roles('superadmin', 'admin')
@UseGuards(AccountingEnabledGuard)
@Controller('opening-balances')
export class OpeningBalancesController {
  constructor(private readonly openingBalancesService: OpeningBalancesService) {}

  @Post()
  setBalance(@Body() dto: SetOpeningBalanceDto) {
    return this.openingBalancesService.setBalance(dto);
  }

  @Get(':periodId')
  getBalances(@Param('periodId') periodId: string) {
    return this.openingBalancesService.getBalances(periodId);
  }
}
