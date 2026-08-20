import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { MarketingAnalysisService } from './marketing-analysis.service';
import { MarketingSyncService } from './marketing-sync.service';

@Roles('superadmin', 'admin', 'manager')
@Controller('marketing/analysis')
@RequiresFeature('marketing_attribution')
export class MarketingAnalysisController {
  constructor(
    private readonly analysis: MarketingAnalysisService,
    private readonly sync: MarketingSyncService,
  ) {}

  @Get('kpis')
  kpis(@Query('fromDate') fromDate?: string, @Query('toDate') toDate?: string) {
    return this.analysis.kpis(fromDate, toDate);
  }

  @Get('overview')
  overview(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('period') period?: string,
  ) {
    return this.analysis.periodOverview(fromDate, toDate, period);
  }

  @Get('intelligence')
  intelligence(@Query('fromDate') fromDate?: string, @Query('toDate') toDate?: string) {
    return this.analysis.intelligence(fromDate, toDate);
  }

  @Get('profitability')
  profitability(@Query('fromDate') fromDate?: string, @Query('toDate') toDate?: string) {
    return this.analysis.profitability(fromDate, toDate);
  }

  @Get('funding-pnl')
  fundingPnL(@Query('fromDate') fromDate?: string, @Query('toDate') toDate?: string) {
    return this.analysis.fundingPnL(fromDate, toDate);
  }

  @Get('campaigns/:id/performance')
  campaignPerformance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.analysis.campaignPerformance(id, fromDate, toDate);
  }

  @Post('summaries/recalculate')
  recalculate(@Query('fromDate') fromDate?: string, @Query('toDate') toDate?: string) {
    return this.analysis.recalculateSummaries(fromDate, toDate);
  }

  @Post('allocations/rebuild')
  rebuildAllocations(@Query('fromDate') fromDate?: string, @Query('toDate') toDate?: string) {
    return this.analysis.rebuildAllocations(fromDate, toDate);
  }

  @Post('sync')
  syncAll(@Query('force') force?: string) {
    return this.sync.syncAll(force === 'true');
  }
}