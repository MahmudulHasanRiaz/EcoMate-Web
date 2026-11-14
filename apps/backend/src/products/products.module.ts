import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { MediaModule } from '../media/media.module';
import { CustomizationService } from '../customization/customization.service';
import { StoresModule } from '../stores/stores.module';

@Module({
  // P5: product writers notify StockStatusSyncService post-commit (acyclic:
  // StoresModule imports only PrismaModule + its own queues).
  imports: [MediaModule, StoresModule],
  controllers: [ProductsController],
  providers: [ProductsService, CustomizationService],
  // ImportModule injects ProductsService to refresh the persisted PLP
  // sort price (syncEffectivePrice) after CSV price writes.
  exports: [ProductsService],
})
export class ProductsModule {}
