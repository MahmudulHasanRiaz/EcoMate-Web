import { SetMetadata, applyDecorators } from '@nestjs/common';

export const FEATURE_KEY = 'feature';
export const REQUIRES_FEATURE_KEY = 'requires_feature';

export const RequiresFeature = (feature: string, ...dependencies: string[]) =>
  applyDecorators(
    SetMetadata(FEATURE_KEY, { feature, dependencies }),
    SetMetadata(REQUIRES_FEATURE_KEY, feature),
  );
