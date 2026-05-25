import { Module } from '@nestjs/common';
import { DeliveryAreasController } from './delivery-areas.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DeliveryAreasController],
})
export class DeliveryAreasModule {}
