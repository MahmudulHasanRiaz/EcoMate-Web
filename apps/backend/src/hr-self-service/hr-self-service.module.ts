import { Module } from '@nestjs/common';
import { HrSelfServiceController } from './hr-self-service.controller';
import { HrSelfServiceService } from './hr-self-service.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PayrollModule } from '../payroll/payroll.module';
import { HrLedgersModule } from '../hr-ledgers/hr-ledgers.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { HrLeaveModule } from '../hr-leave/hr-leave.module';
import { HrScheduleModule } from '../hr-schedule/hr-schedule.module';
import { HrAttendanceModule } from '../hr-attendance/hr-attendance.module';

@Module({
  imports: [
    PrismaModule,
    PayrollModule,
    HrLedgersModule,
    CommissionsModule,
    HrLeaveModule,
    HrScheduleModule,
    HrAttendanceModule,
  ],
  controllers: [HrSelfServiceController],
  providers: [HrSelfServiceService],
})
export class HrSelfServiceModule {}
