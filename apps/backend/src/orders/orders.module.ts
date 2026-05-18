import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { TrackingModule } from '../tracking/tracking.module';

@Module({ controllers: [OrdersController], providers: [OrdersService], imports: [TrackingModule] })
export class OrdersModule {}
