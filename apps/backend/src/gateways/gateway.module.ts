import { Module } from '@nestjs/common';
import { GatewayConfigController } from './gateway-config.controller';
import { BkashPgwController } from './bkash-pgw.controller';
import { BkashPgwService } from './bkash-pgw.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AccountingModule],
  controllers: [GatewayConfigController, BkashPgwController],
  providers: [BkashPgwService],
})
export class GatewayModule {}
