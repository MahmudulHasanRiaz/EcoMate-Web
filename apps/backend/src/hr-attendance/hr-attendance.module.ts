import { Module } from '@nestjs/common';
import { HrAttendanceService } from './hr-attendance.service';
import { HrAttendanceController } from './hr-attendance.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HrAttendanceController],
  providers: [HrAttendanceService],
  exports: [HrAttendanceService],
})
export class HrAttendanceModule {}