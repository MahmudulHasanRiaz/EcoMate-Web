import { Module } from '@nestjs/common';
import { OpeningBalancesService } from './opening-balances.service';
import { OpeningBalancesController } from './opening-balances.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OpeningBalancesController],
  providers: [OpeningBalancesService],
  exports: [OpeningBalancesService],
})
export class OpeningBalancesModule {}
