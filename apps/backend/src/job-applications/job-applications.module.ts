import { Module } from '@nestjs/common';
import { JobApplicationsController } from './job-applications.controller';
import { JobApplicationsService } from './job-applications.service';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [JobApplicationsController],
  providers: [JobApplicationsService, StorageService],
  exports: [JobApplicationsService],
})
export class JobApplicationsModule {}
