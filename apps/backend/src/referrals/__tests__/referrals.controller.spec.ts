import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ReferralsController } from '../referrals.controller';

describe('ReferralsController', () => {
  const adminMethods = ['findAll', 'findOne', 'findLeads'];

  const publicMethods = ['claimReferral'];

  describe('admin methods', () => {
    it.each(adminMethods)(
      'adds RequiresFeature(admin_referrals) on %s',
      (method) => {
        const meta = Reflect.getMetadata(
          REQUIRES_FEATURE_KEY,
          ReferralsController.prototype[method],
        );
        expect(meta).toBe('admin_referrals');
      },
    );
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        ReferralsController.prototype[method],
      );
      expect(meta).toBeUndefined();
    });
  });
});
