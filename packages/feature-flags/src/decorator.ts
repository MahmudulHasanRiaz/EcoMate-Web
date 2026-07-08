import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'feature';
export const REQUIRES_FEATURE_KEY = 'requires_feature';

export const RequiresFeature = (feature: string, ...dependencies: string[]) =>
  SetMetadata(FEATURE_KEY, { feature, dependencies });
