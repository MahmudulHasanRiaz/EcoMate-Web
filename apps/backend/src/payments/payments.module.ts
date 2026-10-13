import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CodMismatchModule } from '../cod-mismatch/cod-mismatch.module';

@Module({
  imports: [CodMismatchModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
