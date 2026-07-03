import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { PosOrdersController } from './pos-orders.controller';
import { PosOrdersService } from './pos-orders.service';

@Module({
  controllers: [SessionsController, PosOrdersController],
  providers: [SessionsService, PosOrdersService],
})
export class PosModule {}
