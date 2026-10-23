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
import { BackfillJournalsDto } from './dto/backfill-journals.dto';
import { PaymentJournalService } from './payment-journal.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('accounting')
@Roles('superadmin', 'admin')
@UseGuards(AccountingEnabledGuard)
@RequiresFeature('admin_accounting')
export class AccountingController {
  constructor(
    private readonly accountingService: AccountingService,
    private readonly paymentJournal: PaymentJournalService,
  ) {}

  @Post('entries')
  createEntry(@Body() dto: CreateJournalEntryDto, @CurrentUser() user?: any) {
    return this.accountingService.createEntry(dto, user?.sub);
  }

  /**
   * Phase 2 — post journals for payments RECORDED before the feature shipped
   * (or while accounting was off). Idempotent: candidates are filtered on
   * `journalEntryId IS NULL` and every poster re-checks under the row lock, so
   * re-running changes nothing. Always start with `{ "dryRun": true }`.
   */
  @Post('payments/backfill-journals')
  backfillPaymentJournals(@Body() dto: BackfillJournalsDto) {
    return this.paymentJournal.backfillRecordedPayments(dto);
  }

  /**
   * The admin's journal-entries page consumes this endpoint as a paginated
   * envelope (`{ data, meta }`) and renders `meta.totalPages`; it also reads
   * `response.data.data`. Returning the service's own flat
   * `{ data, total, page, perPage, totalPages }` shape left the pager reading
   * `meta?.totalPages ?? 1`, so page count was always 1 and the Next/Previous
   * controls never appeared. The service keeps its flat shape for internal
   * callers; the envelope is applied here, at the HTTP boundary, mirroring
   * FinancialPeriodsController.findAll.
   */
  @Get('entries')
  async findAllEntries(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('periodId') periodId?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const perPageNum = perPage ? parseInt(perPage, 10) : 10;
    if (isNaN(pageNum) || pageNum < 1 || isNaN(perPageNum) || perPageNum < 1) {
      throw new BadRequestException(
        'Page and perPage must be positive numbers',
      );
    }
    const result = await this.accountingService.findAllEntries(
      pageNum,
      perPageNum,
      periodId,
    );
    return {
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        perPage: result.perPage,
        totalPages: result.totalPages,
      },
    };
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
