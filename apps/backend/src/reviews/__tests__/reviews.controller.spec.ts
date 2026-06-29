import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ReviewsController } from '../reviews.controller';

describe('ReviewsController', () => {
  const adminMethods = ['findAll', 'approve', 'remove'];

  const publicMethods = ['findByProduct', 'create', 'findLatest'];

  describe('admin methods', () => {
    it.each(adminMethods)('adds RequiresFeature(admin_reviews) on %s', (method) => {
      const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, ReviewsController.prototype[method]);
      expect(meta).toBe('admin_reviews');
    });
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, ReviewsController.prototype[method]);
      expect(meta).toBeUndefined();
    });
  });
});
