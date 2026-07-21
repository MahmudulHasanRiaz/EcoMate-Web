import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { RateLimitPolicy } from './rate-limit-policy.decorator';
import { TrustTierService } from './trust-tier.service';

@Controller('rate-limit')
export class RateLimitController {
  constructor(
    private readonly tierService: TrustTierService,
  ) {}

  /**
   * Browser trust challenge endpoint.
   * Lightweight — no DB, no heavy computation.
   * Client JS calls this once per 24h to prove JS execution.
   */
  @Public()
  @RateLimitPolicy('browser_check')
  @Get('browser-check')
  @HttpCode(HttpStatus.OK)
  browserCheck(): { token: string } {
    return { token: this.tierService.createBrowserTrustToken() };
  }
}
