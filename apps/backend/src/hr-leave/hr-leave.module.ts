import { Module } from '@nestjs/common';
import { HrLeaveService } from './hr-leave.service';
import { HrLeaveController } from './hr-leave.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HrLeaveController],
  providers: [HrLeaveService],
  exports: [HrLeaveService],
})
export class HrLeaveModule {}
