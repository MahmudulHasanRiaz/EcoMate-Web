import { Module } from '@nestjs/common';
import { JobPostingsController, HrJobPostingsController } from './job-postings.controller';
import { JobPostingsService } from './job-postings.service';
import { JobApplicationsModule } from '../job-applications/job-applications.module';

@Module({
  imports: [JobApplicationsModule],
  controllers: [JobPostingsController, HrJobPostingsController],
  providers: [JobPostingsService],
  exports: [JobPostingsService],
})
export class JobPostingsModule {}
