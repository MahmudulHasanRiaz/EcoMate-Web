import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('analytics')
@RequiresFeature('admin_analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get('sales-kpi')
  async getSalesKpi(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analytics.getSalesKpi(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('revenue-trend')
  async getRevenueTrend(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analytics.getRevenueTrend(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('marketing-kpi')
  async getMarketingKpi(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analytics.getMarketingKpi(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('traffic-sources')
  async getTrafficSources(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analytics.getTrafficSources(startDate, endDate);
  }
}
