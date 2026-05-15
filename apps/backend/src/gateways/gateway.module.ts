import { Module } from '@nestjs/common';
import { GatewayConfigController } from './gateway-config.controller';

@Module({ controllers: [GatewayConfigController] })
export class GatewayModule {}
