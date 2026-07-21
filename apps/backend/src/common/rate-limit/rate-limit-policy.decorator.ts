import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_POLICY_KEY } from './rate-limit-policy.interface';

export const RateLimitPolicy = (policy: string) => SetMetadata(RATE_LIMIT_POLICY_KEY, policy);
