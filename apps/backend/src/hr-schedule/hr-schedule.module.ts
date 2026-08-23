import { Module } from '@nestjs/common';
import { HrScheduleService } from './hr-schedule.service';
import { HrScheduleController } from './hr-schedule.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HrScheduleController],
  providers: [HrScheduleService],
  exports: [HrScheduleService],
})
export class HrScheduleModule {}