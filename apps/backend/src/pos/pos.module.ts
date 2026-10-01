import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { PosOrdersController } from './pos-orders.controller';
import { PosOrdersService } from './pos-orders.service';
import { MediaModule } from '../media/media.module';
import { TrackingModule } from '../tracking/tracking.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [MediaModule, TrackingModule, CommissionsModule, CustomersModule],
  controllers: [SessionsController, PosOrdersController],
  providers: [SessionsService, PosOrdersService],
})
export class PosModule {}
