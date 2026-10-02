import { Module } from '@nestjs/common';
import { ShiftService } from './hr-shifts.service';
import { ShiftController } from './hr-shifts.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ShiftController],
  providers: [ShiftService],
  exports: [ShiftService],
})
export class HrShiftsModule {}