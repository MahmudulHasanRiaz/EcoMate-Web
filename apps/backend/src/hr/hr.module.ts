import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { OrdersModule } from '../orders/orders.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [OrdersModule, TasksModule],
  controllers: [HrController],
  providers: [HrService],
})
export class HrModule {}