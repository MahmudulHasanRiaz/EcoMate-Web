import { Controller, Post, Body, Req, BadRequestException } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
import { MarketingAttributionService } from './marketing-attribution.service';
import { CaptureSessionDto } from './dto/marketing.dto';

/**
 * Storefront landing/journey capture. Kept public + rate-limited: the
 * storefront records every landing regardless of license state (data is
 * cheap and the module only surfaces it when the feature is enabled).
 */
@Controller('marketing')
export class MarketingCaptureController {
  constructor(private readonly attribution: MarketingAttributionService) {}

  @Public()
  @RateLimitPolicy('storefront')
  @Post('capture')
  async capture(
    @Body() dto: CaptureSessionDto,
    @Req() req: any,
  ) {
    const ip =
      (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      null;
    return this.attribution.captureSession(dto, ip);
  }
}