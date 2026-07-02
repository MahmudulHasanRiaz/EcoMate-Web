import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CheckoutLeadsController } from '../checkout-leads.controller';

describe('CheckoutLeadsController', () => {
  const adminMethods = [
    'findAll',
    'summary',
    'findOne',
    'updateStatus',
    'assign',
    'convert',
    'bulkAssign',
    'bulkStatus',
  ];

  const publicMethods = ['upsert'];

  describe('admin methods', () => {
    it.each(adminMethods)(
      'adds RequiresFeature(admin_checkout_leads) on %s',
      (method) => {
        const meta = Reflect.getMetadata(
          REQUIRES_FEATURE_KEY,
          CheckoutLeadsController.prototype[method],
        );
        expect(meta).toBe('admin_checkout_leads');
      },
    );
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        CheckoutLeadsController.prototype[method],
      );
      expect(meta).toBeUndefined();
    });
  });
});
