import { Module } from '@nestjs/common';
import { StoreLocationsController } from './store-locations.controller';
import { StoreLocationsService } from './store-locations.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StoreLocationsController],
  providers: [StoreLocationsService],
  exports: [StoreLocationsService],
})
export class StoreLocationsModule {}
