import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ProductsController } from '../products.controller';

describe('ProductsController', () => {
  const adminMethods = [
    'bulkRemove',
    'bulkUpdate',
    'create',
    'update',
    'remove',
    'generateVariants',
    'updateVariant',
  ];

  const publicMethods = ['findAll', 'findBySlug', 'findOne'];

  describe('admin methods', () => {
    it.each(adminMethods)(
      'adds RequiresFeature(admin_products) on %s',
      (method) => {
        const meta = Reflect.getMetadata(
          REQUIRES_FEATURE_KEY,
          ProductsController.prototype[method],
        );
        expect(meta).toBe('admin_products');
      },
    );
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        ProductsController.prototype[method],
      );
      expect(meta).toBeUndefined();
    });
  });
});
