import { Controller, Post, Body, Req } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Public()
  @Post('events')
  async trackEvent(
    @Body()
    body: {
      eventName: string;
      eventId?: string;
      customData?: Record<string, any>;
      userData?: Record<string, any>;
    },
    @Req() req: any,
  ) {
    await this.tracking.track({
      eventName: body.eventName,
      eventId: body.eventId,
      userData: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        ...body.userData,
      },
      customData: body.customData,
    });
    return { success: true };
  }

  @Public()
  @Post('context')
  async saveContext(
    @Body() body: { orderId: string; fbp?: string; fbc?: string; url?: string; referrer?: string },
  ) {
    if (body.orderId) {
      await this.tracking.saveContext(body.orderId, {
        fbp: body.fbp,
        fbc: body.fbc,
        url: body.url,
        referrer: body.referrer,
      });
    }
    return { success: true };
  }
}
