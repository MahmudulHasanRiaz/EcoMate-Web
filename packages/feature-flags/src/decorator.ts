import { SetMetadata } from '@nestjs/common';

export const REQUIRES_FEATURE_KEY = 'requires_feature';

export const RequiresFeature = (featureKey: string) =>
  SetMetadata(REQUIRES_FEATURE_KEY, featureKey);
