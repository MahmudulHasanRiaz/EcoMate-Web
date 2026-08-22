import {
  Controller,
  Get,
  Post,
  Query,
  Headers,
  Body,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { enqueueMarketingSync } from './marketing-sync.processor';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  WEBHOOK_VERIFY_TOKEN_SETTING,
  WEBHOOK_APP_SECRET_SETTING,
  MARKETING_QUEUE,
} from './marketing.constants';

/**
 * Meta Graph webhook: `hub.mode=subscribe` verification (echo) + purchase
 * event delivery. Events are stored raw (MarketingRawPayload) and enqueue an
 * insights refresh so ROAS data stays current.
 */
@Controller('marketing/webhooks')
export class MarketingWebhooksController {
  private readonly logger = new Logger(MarketingWebhooksController.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue(MARKETING_QUEUE) private queue: Queue,
  ) {}

  @Public()
  @Get('meta')
  async verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: WEBHOOK_VERIFY_TOKEN_SETTING },
    });
    if (mode === 'subscribe' && setting?.value && token === setting.value) {
      return challenge;
    }
    throw new ConflictException('Verification failed');
  }

  @Public()
  @RateLimitPolicy('api')
  @Post('meta')
  async event(@Body() payload: any, @Headers('x-hub-signature-256') signature?: string) {
    const appSecret = await this.prisma.systemSetting.findUnique({
      where: { key: WEBHOOK_APP_SECRET_SETTING },
    });

    if (appSecret?.value) {
      const crypto = await import('crypto');
      const expected =
        'sha256=' +
        crypto
          .createHmac('sha256', appSecret.value)
          .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
          .digest('hex');
      if (!signature || expected !== signature) {
        throw new BadRequestException('Invalid signature');
      }
    }

    await this.prisma.marketingRawPayload.create({
      data: {
        provider: 'facebook',
        endpoint: 'webhook',
        objectType: payload?.object ?? 'unknown',
        objectId: typeof payload?.id === 'string' ? payload.id : null,
        payloadJson: payload as any,
      },
    });

    if (payload?.object === 'ad_account' || payload?.object === 'page') {
      await enqueueMarketingSync(this.queue as any, {
        type: 'sync-all',
        forceInsights: true,
      });
    }

    return { received: true };
  }
}