import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [ImportController],
  providers: [ImportService, PrismaService, MediaService, StorageService],
  exports: [ImportService],
})
export class ImportModule {}
