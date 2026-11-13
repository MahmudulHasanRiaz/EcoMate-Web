import { Module } from '@nestjs/common';
import { SupportEnquiriesController } from './support-enquiries.controller';
import { SupportEnquiriesService } from './support-enquiries.service';

@Module({
  controllers: [SupportEnquiriesController],
  providers: [SupportEnquiriesService],
})
export class SupportEnquiriesModule {}
