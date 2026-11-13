import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { StoreLocationsController } from '../store-locations.controller';

describe('StoreLocationsController', () => {
  const adminMethods = [
    'findAllAdmin',
    'findOneAdmin',
    'create',
    'update',
    'remove',
  ];
  const publicMethods = ['findAllPublic', 'findOnePublic'];

  describe('admin methods', () => {
    it.each(adminMethods)('adds RequiresFeature(admin_cms) on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        StoreLocationsController.prototype[
          method as keyof StoreLocationsController
        ],
      );
      expect(meta).toBe('admin_cms');
    });
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        StoreLocationsController.prototype[
          method as keyof StoreLocationsController
        ],
      );
      expect(meta).toBeUndefined();
    });
  });
});
