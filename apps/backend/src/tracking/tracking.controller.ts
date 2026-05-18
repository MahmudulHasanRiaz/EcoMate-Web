import { Controller, Post, Body, Req } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Public()
  @Post('events')
  async trackEvent(
    @Body() body: { eventName: string; eventId?: string; customData?: Record<string, any>; userData?: Record<string, any> },
    @Req() req: any,
  ) {
    await this.tracking.track({
      eventName: body.eventName,
      eventId: body.eventId,
      userData: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        ...body.userData, // ফ্রন্টএন্ড থেকে আসা ইউজার ডাটা এখানে মার্জ হচ্ছে
      },
      customData: body.customData,
    });
    return { success: true };
  }
}
