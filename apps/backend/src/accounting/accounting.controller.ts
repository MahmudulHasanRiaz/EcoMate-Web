import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { AccountingEnabledGuard } from './accounting-enabled.guard';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('accounting')
@Roles('superadmin', 'admin')
@UseGuards(AccountingEnabledGuard)
@RequiresFeature('admin_accounting')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  @Post('entries')
  createEntry(@Body() dto: CreateJournalEntryDto, @CurrentUser() user?: any) {
    return this.accountingService.createEntry(dto, user?.sub);
  }

  @Get('entries')
  findAllEntries(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('periodId') periodId?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const perPageNum = perPage ? parseInt(perPage, 10) : 10;
    if (
      isNaN(pageNum) ||
      pageNum < 1 ||
      isNaN(perPageNum) ||
      perPageNum < 1
    ) {
      throw new BadRequestException(
        'Page and perPage must be positive numbers',
      );
    }
    return this.accountingService.findAllEntries(
      pageNum,
      perPageNum,
      periodId,
    );
  }

  @Get('entries/:id')
  getEntry(@Param('id') id: string) {
    return this.accountingService.getEntry(id);
  }

  @Delete('entries/:id')
  deleteEntry(@Param('id') id: string) {
    return this.accountingService.deleteEntry(id);
  }

  @Get('reports/trial-balance')
  trialBalance(@Query('periodId') periodId: string) {
    return this.accountingService.trialBalance(periodId);
  }

  @Get('reports/profit-and-loss')
  profitAndLoss(@Query('periodId') periodId: string) {
    return this.accountingService.profitAndLoss(periodId);
  }

  @Get('reports/balance-sheet')
  balanceSheet(@Query('periodId') periodId: string) {
    return this.accountingService.balanceSheet(periodId);
  }

  @Get('reports/ledger/:accountId')
  accountLedger(
    @Param('accountId') accountId: string,
    @Query('periodId') periodId?: string,
  ) {
    return this.accountingService.accountLedger(accountId, periodId);
  }
}
