import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { OrderImportService } from './order-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { StorageService } from '../storage/storage.service';
import { CustomersModule } from '../customers/customers.module';
import { ImportJobManager } from './import-job-manager';

@Module({
  controllers: [ImportController],
  providers: [
    ImportService,
    OrderImportService,
    PrismaService,
    MediaService,
    StorageService,
    ImportJobManager,
  ],
  imports: [CustomersModule],
  exports: [ImportService, OrderImportService, ImportJobManager],
})
export class ImportModule {}
