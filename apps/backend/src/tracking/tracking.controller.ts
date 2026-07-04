import { Controller, Post, Body, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import * as fastify from 'fastify';
import { TrackingService } from './tracking.service';
import { Public } from '../common/decorators/public.decorator';
import { TrackEventDto } from './dto/track-event.dto';
import { SaveContextDto } from './dto/save-context.dto';

@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Post('events')
  async trackEvent(
    @Body() body: TrackEventDto,
    @Req() req: fastify.FastifyRequest,
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
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Post('context')
  async saveContext(@Body() body: SaveContextDto) {
    await this.tracking.saveContext(body.orderId, {
      fbp: body.fbp,
      fbc: body.fbc,
      url: body.url,
      referrer: body.referrer,
    });
    return { success: true };
  }
}
