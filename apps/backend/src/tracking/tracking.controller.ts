import { Controller, Post, Body, Req, Ip } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import * as fastify from 'fastify';
import { TrackingService } from './tracking.service';
import { Public } from '../common/decorators/public.decorator';
import { TrackEventDto } from './dto/track-event.dto';
import { SaveContextDto } from './dto/save-context.dto';
import { PageViewDto } from './dto/page-view.dto';
import { PageViewBufferService } from './page-view-buffer.service';

@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly pageViewBuffer: PageViewBufferService,
  ) {}

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

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 100 } })
  @Post('page-view')
  async trackPageView(
    @Body() body: PageViewDto,
    @Ip() ip: string,
    @Req() req: fastify.FastifyRequest,
  ) {
    const source = this.classifySource(body.referrer || null);
    this.pageViewBuffer.push({
      url: body.url,
      referrer: body.referrer || null,
      source,
      userAgent: (req.headers['user-agent'] as string) || '',
      ip,
      sessionId: body.sessionId || null,
      timestamp: new Date(),
    });
    return { ok: true };
  }

  private classifySource(referrer: string | null): string {
    if (!referrer) return 'direct';
    try {
      const hostname = new URL(referrer).hostname;
      if (/facebook|fb\.(com|me)|\.facebook\./.test(hostname))
        return 'facebook';
      if (/instagram|\.cdninstagram/.test(hostname)) return 'instagram';
      if (/google\.|goo\.gl/.test(hostname)) return 'google';
      if (/tiktok/.test(hostname)) return 'tiktok';
      return 'other';
    } catch {
      return 'other';
    }
  }
}
