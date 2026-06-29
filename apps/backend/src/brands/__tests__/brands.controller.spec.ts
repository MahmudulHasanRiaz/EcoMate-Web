import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { BrandsController } from '../brands.controller';

describe('BrandsController', () => {
  const adminMethods = ['create', 'update', 'remove'];

  const publicMethods = ['findAll', 'findOne'];

  describe('admin methods', () => {
    it.each(adminMethods)('adds RequiresFeature(admin_brands) on %s', (method) => {
      const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, BrandsController.prototype[method]);
      expect(meta).toBe('admin_brands');
    });
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, BrandsController.prototype[method]);
      expect(meta).toBeUndefined();
    });
  });
});
