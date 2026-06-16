import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TasksModule } from './tasks/tasks.module';
import { SettingsModule } from './settings/settings.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { CategoriesModule } from './categories/categories.module';
import { AttributesModule } from './attributes/attributes.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { OrderStatusController } from './orders/order-status.controller';
import { PaymentsModule } from './payments/payments.module';
import { UploadModule } from './upload/upload.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';
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
import { JwtAuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { IpBlockMiddleware } from './common/middleware/ip-block.middleware';
import { BlockedEntriesModule } from './blocked-entries/blocked-entries.module';
import { BlockSettingsModule } from './block-settings/block-settings.module';
import { SecurityModule } from './security/security.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TasksModule,
    SettingsModule,
    DashboardModule,
    CategoriesModule,
    AttributesModule,
    ProductsModule,
    OrdersModule,
    PaymentsModule,
    UploadModule,
    SystemSettingsModule,
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
  ],
  controllers: [OrderStatusController],
  providers: [
    { provide: APP_PIPE, useClass: ValidationPipe },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes('*');
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
