import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CampaignsController } from '../campaigns.controller';

describe('CampaignsController', () => {
  it('has RequiresFeature(admin_campaigns) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, CampaignsController);
    expect(featureKey).toBe('admin_campaigns');
  });
});
