import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { PaymentsController } from '../payments.controller';

describe('PaymentsController', () => {
  const adminMethods = ['findAll', 'verify'];

  const publicMethods = ['create'];

  describe('admin methods', () => {
    it.each(adminMethods)('adds RequiresFeature(admin_payments) on %s', (method) => {
      const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, PaymentsController.prototype[method]);
      expect(meta).toBe('admin_payments');
    });
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, PaymentsController.prototype[method]);
      expect(meta).toBeUndefined();
    });
  });
});
