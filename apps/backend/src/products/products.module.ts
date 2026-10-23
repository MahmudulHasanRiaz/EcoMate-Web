import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { MediaModule } from '../media/media.module';
import { CustomizationService } from '../customization/customization.service';

@Module({
  imports: [MediaModule],
  controllers: [ProductsController],
  providers: [ProductsService, CustomizationService],
})
export class ProductsModule {}
