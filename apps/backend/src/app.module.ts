import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
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
import { JwtAuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule, AuthModule, UsersModule, TasksModule,
    SettingsModule, DashboardModule, CategoriesModule,
    AttributesModule, ProductsModule, OrdersModule, PaymentsModule, UploadModule, SystemSettingsModule, MediaModule, CustomersModule, CourierModule,
  ],
  controllers: [OrderStatusController],
  providers: [
    { provide: APP_PIPE, useClass: ValidationPipe },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
