import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { CodMismatchModule } from '../cod-mismatch/cod-mismatch.module';
import { RefundPermissionGuard } from './refund-permission.guard';

@Module({
  imports: [CodMismatchModule],
  controllers: [RefundsController],
  providers: [RefundsService, RefundPermissionGuard],
})
export class RefundsModule {}
