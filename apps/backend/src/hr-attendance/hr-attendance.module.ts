import { Module } from '@nestjs/common';
import { HrAttendanceService } from './hr-attendance.service';
import { HrAttendanceController } from './hr-attendance.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { HrShiftsModule } from '../hr-shifts/hr-shifts.module';

@Module({
  // HrShiftsModule owns ShiftService (shift resolution). It imports nothing but
  // PrismaModule, so there is no cycle.
  imports: [PrismaModule, HrShiftsModule],
  controllers: [HrAttendanceController],
  providers: [HrAttendanceService],
  exports: [HrAttendanceService],
})
export class HrAttendanceModule {}