import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { OrderImportService } from './order-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { StorageService } from '../storage/storage.service';
import { CustomersModule } from '../customers/customers.module';

@Module({
  controllers: [ImportController],
  providers: [
    ImportService,
    OrderImportService,
    PrismaService,
    MediaService,
    StorageService,
  ],
  imports: [CustomersModule],
  exports: [ImportService, OrderImportService],
})
export class ImportModule {}
