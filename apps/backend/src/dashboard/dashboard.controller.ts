import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('dashboard')
@RequiresFeature('admin_dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get('stats')
  async getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getStats(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('analytics')
  async getAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getAnalytics(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('pending-orders')
  async getPendingOrders(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getPendingOrders(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('low-stock')
  async getLowStockProducts() {
    return this.dashboardService.getLowStockProducts();
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('top-products')
  async getTopProducts(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getTopProducts(
      startDate,
      endDate,
      limit ? parseInt(limit) : 10,
    );
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('order-status-distribution')
  async getOrderStatusDistribution(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getOrderStatusDistribution(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('revenue-by-payment')
  async getRevenueByPaymentMethod(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getRevenueByPaymentMethod(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('new-customers')
  async getNewCustomers(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getNewCustomers(startDate, endDate);
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('pending-refunds')
  async getPendingRefunds() {
    return this.dashboardService.getPendingRefunds();
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('pending-dispatch')
  async getPendingDispatch() {
    return this.dashboardService.getPendingDispatch();
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('pending-payments')
  async getPendingPayments() {
    return this.dashboardService.getPendingPayments();
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('today-kpi')
  async getTodayKpi() {
    return this.dashboardService.getTodayKpi();
  }

  @Roles('superadmin', 'admin', 'manager')
  @Get('activity-log')
  async getActivityLog() {
    return this.dashboardService.getActivityLog();
  }
}
