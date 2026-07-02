import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { LandingPagesController } from '../landing-pages.controller';

describe('LandingPagesController', () => {
  const adminMethods = [
    'list',
    'findById',
    'create',
    'update',
    'publish',
    'unpublish',
    'remove',
  ];

  const publicMethods = ['findPublished', 'findPreview'];

  describe('admin methods', () => {
    it.each(adminMethods)(
      'adds RequiresFeature(admin_landing_pages) on %s',
      (method) => {
        const meta = Reflect.getMetadata(
          REQUIRES_FEATURE_KEY,
          LandingPagesController.prototype[method],
        );
        expect(meta).toBe('admin_landing_pages');
      },
    );
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        LandingPagesController.prototype[method],
      );
      expect(meta).toBeUndefined();
    });
  });
});
