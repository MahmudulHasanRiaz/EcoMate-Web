import { ThrottlerGuard } from '@nestjs/throttler';
import { Injectable } from '@nestjs/common';

/**
 * Custom throttler guard with bypass semantics.
 *
 * NEVER honors request-header bypass.  An environment-based bypass
 * is available ONLY when NODE_ENV=test AND BYPASS_THROTTLE=true.
 * This allows test suites to disable rate limiting without
 * exposing a header-triggered bypass in production.
 */
@Injectable()
export class EcoMateThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: any): Promise<boolean> {
    return (
      process.env.NODE_ENV === 'test' &&
      process.env.BYPASS_THROTTLE === 'true'
    );
  }
}
