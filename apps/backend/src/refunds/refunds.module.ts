import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { CodMismatchModule } from '../cod-mismatch/cod-mismatch.module';
import { DispatchCancelModule } from '../dispatch-cancel/dispatch-cancel.module';
import { RefundPermissionGuard } from './refund-permission.guard';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [CodMismatchModule, DispatchCancelModule, AccountingModule],
  controllers: [RefundsController],
  providers: [RefundsService, RefundPermissionGuard],
})
export class RefundsModule {}
