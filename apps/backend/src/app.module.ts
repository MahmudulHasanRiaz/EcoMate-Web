import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FeatureGuard } from '@ecomate/feature-flags';
import { LicenseGuard } from './license/license.guard';
import { LicenseModule } from './license/license.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TasksModule } from './tasks/tasks.module';
import { SettingsModule } from './settings/settings.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CategoriesModule } from './categories/categories.module';
import { BrandsModule } from './brands/brands.module';
import { AttributesModule } from './attributes/attributes.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';

import { PaymentsModule } from './payments/payments.module';
import { UploadModule } from './upload/upload.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';
import { MobileDownloadModule } from './mobile-download/mobile-download.module';
import { MobileBuilderModule } from './mobile-builder/mobile-builder.module';
import { MediaModule } from './media/media.module';
import { CustomersModule } from './customers/customers.module';
import { CourierModule } from './courier/courier.module';
import { GatewayModule } from './gateways/gateway.module';
import { HealthModule } from './health/health.module';
import { CouponsModule } from './coupons/coupons.module';
import { ShipmentModule } from './shipment/shipment.module';
import { RefundsModule } from './refunds/refunds.module';
import { InventoryModule } from './inventory/inventory.module';
import { CourierManagerModule } from './courier-manager/courier-manager.module';
import { CombosModule } from './combos/combos.module';
import { TrackingModule } from './tracking/tracking.module';
import { CheckoutLeadsModule } from './checkout-leads/checkout-leads.module';
import { DeliveryAreasModule } from './delivery-areas/delivery-areas.module';
import { ShippingModule } from './shipping/shipping.module';
import { ImportModule } from './import/import.module';
import { SizeChartsModule } from './size-charts/size-charts.module';
import { CmsPagesModule } from './cms-pages/cms-pages.module';
import { TagsModule } from './tags/tags.module';
import { ReviewsModule } from './reviews/reviews.module';
import { ImagesModule } from './images/images.module';
import { AddressesModule } from './addresses/addresses.module';
import { CacheModule } from './cache/cache.module';
import { RolesGuard } from './auth/roles.guard';
import { DualModeAuthGuard } from './common/guards/dual-mode-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { BetterAuthModule } from './better-auth/better-auth.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { IpBlockMiddleware } from './common/middleware/ip-block.middleware';
import { BlockedEntriesModule } from './blocked-entries/blocked-entries.module';
import { BlockSettingsModule } from './block-settings/block-settings.module';
import { SecurityModule } from './security/security.module';
import { SearchModule } from './search/search.module';
import { LandingPagesModule } from './landing-pages/landing-pages.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchasesModule } from './purchases/purchases.module';
import { ExpensesModule } from './expenses/expenses.module';
import { ExpenseCategoriesModule } from './expense-categories/expense-categories.module';
import { FeedModule } from './feed/feed.module';
import { QueueModule } from './queue/queue.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReferralsModule } from './referrals/referrals.module';
import { EmployeesModule } from './employees/employees.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { AccessPresetsModule } from './access-presets/access-presets.module';
import { DesignationsModule } from './designations/designations.module';
import { AccountsModule } from './accounts/accounts.module';
import { PayrollModule } from './payroll/payroll.module';
import { StockModule } from './stock/stock.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { PosModule } from './pos/pos.module';
import { FinancialPeriodsModule } from './financial-periods/financial-periods.module';
import { OpeningBalancesModule } from './opening-balances/opening-balances.module';
import { PackingModule } from './packing/packing.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { AccountingModule } from './accounting/accounting.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthSettingsModule } from './auth-settings/auth-settings.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { SecurityDashboardModule } from './security-dashboard/security-dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RateLimitModule,
    SecurityDashboardModule,
    PrismaModule,
    JwtModule.register({}),
    AuthModule,
    UsersModule,
    TasksModule,
    SettingsModule,
    DashboardModule,
    CategoriesModule,
    BrandsModule,
    AttributesModule,
    ProductsModule,
    OrdersModule,
    PackingModule,
    DispatchModule,
    PaymentsModule,
    UploadModule,
    SystemSettingsModule,
    MobileDownloadModule,
    MobileBuilderModule,
    MediaModule,
    CustomersModule,
    CourierModule,
    GatewayModule,
    HealthModule,
    CouponsModule,
    ShipmentModule,
    RefundsModule,
    InventoryModule,
    CourierManagerModule,
    CombosModule,
    TrackingModule,
    CheckoutLeadsModule,
    DeliveryAreasModule,
    ShippingModule,
    ImportModule,
    SizeChartsModule,
    CmsPagesModule,
    TagsModule,
    ReviewsModule,
    ImagesModule,
    AddressesModule,
    CacheModule,
    BlockedEntriesModule,
    BlockSettingsModule,
    SecurityModule,
    SearchModule,
    LandingPagesModule,
    LicenseModule,
    QueueModule,
    SuppliersModule,
    PurchasesModule,
    ExpensesModule,
    ExpenseCategoriesModule,
    FeedModule,
    NotificationsModule,
    ReferralsModule,
    CampaignsModule,
    AccessPresetsModule,
    DesignationsModule,
    EmployeesModule,
    PayrollModule,
    FinancialPeriodsModule,
    OpeningBalancesModule,
    AccountsModule,
    AccountingModule,
    AnalyticsModule,
    StockModule,
    WarehousesModule,
    PosModule,
    BetterAuthModule,
    AuthSettingsModule,
  ],

  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    },
    { provide: APP_GUARD, useClass: DualModeAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: LicenseGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
    consumer
      .apply(IpBlockMiddleware)
      .exclude(
        'api/blocked-entries/(.*)',
        'api/block-settings/(.*)',
        'api/security/(.*)',
      )
      .forRoutes('*');
  }
}
