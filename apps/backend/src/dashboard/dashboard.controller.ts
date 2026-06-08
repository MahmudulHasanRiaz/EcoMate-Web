import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get('stats')
  async getStats() {
    return this.dashboardService.getStats();
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('analytics')
  async getAnalytics() {
    return this.dashboardService.getAnalytics();
  }
}
