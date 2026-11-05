import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { MediaModule } from '../media/media.module';
import { CustomizationService } from '../customization/customization.service';

@Module({
  imports: [MediaModule],
  controllers: [ProductsController],
  providers: [ProductsService, CustomizationService],
  // ImportModule injects ProductsService to refresh the persisted PLP
  // sort price (syncEffectivePrice) after CSV price writes.
  exports: [ProductsService],
})
export class ProductsModule {}
