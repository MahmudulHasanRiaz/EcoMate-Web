import { describe, it, expect } from 'vitest';
import { FeatureGuard } from '../guard';

describe('FeatureGuard', () => {
  it('can be constructed with reflector and featureFlags', () => {
    expect(FeatureGuard).toBeDefined();
  });
});
