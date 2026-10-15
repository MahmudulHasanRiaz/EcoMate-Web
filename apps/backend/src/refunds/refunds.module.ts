import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { CodMismatchModule } from '../cod-mismatch/cod-mismatch.module';

@Module({
  imports: [CodMismatchModule],
  controllers: [RefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
