import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { PosOrdersController } from './pos-orders.controller';
import { PosOrdersService } from './pos-orders.service';
import { MediaModule } from '../media/media.module';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [MediaModule, TrackingModule],
  controllers: [SessionsController, PosOrdersController],
  providers: [SessionsService, PosOrdersService],
})
export class PosModule {}
