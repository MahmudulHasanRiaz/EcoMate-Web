import { Module } from '@nestjs/common';
import { GatewayConfigController } from './gateway-config.controller';
import { BkashPgwController } from './bkash-pgw.controller';
import { BkashPgwService } from './bkash-pgw.service';

@Module({ controllers: [GatewayConfigController, BkashPgwController], providers: [BkashPgwService] })
export class GatewayModule {}
