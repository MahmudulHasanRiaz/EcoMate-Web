import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CategoriesController } from '../categories.controller';

describe('CategoriesController', () => {
  const adminMethods = ['create', 'update', 'remove'];

  const publicMethods = ['findAll', 'getMenuCategories', 'findOne'];

  describe('admin methods', () => {
    it.each(adminMethods)(
      'adds RequiresFeature(admin_categories) on %s',
      (method) => {
        const meta = Reflect.getMetadata(
          REQUIRES_FEATURE_KEY,
          CategoriesController.prototype[method],
        );
        expect(meta).toBe('admin_categories');
      },
    );
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        CategoriesController.prototype[method],
      );
      expect(meta).toBeUndefined();
    });
  });
});
