import { Module } from '@nestjs/common';
import { HrLedgersService } from './hr-ledgers.service';
import { HrLedgersController } from './hr-ledgers.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HrLedgersController],
  providers: [HrLedgersService],
  exports: [HrLedgersService],
})
export class HrLedgersModule {}
