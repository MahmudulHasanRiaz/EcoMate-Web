import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CmsPagesController } from '../cms-pages.controller';

describe('CmsPagesController', () => {
  const adminMethods = ['findAll', 'findOne', 'create', 'update', 'remove'];

  const publicMethods = ['findActiveForFooter', 'findBySlug'];

  describe('admin methods', () => {
    it.each(adminMethods)('adds RequiresFeature(admin_cms) on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        CmsPagesController.prototype[method],
      );
      expect(meta).toBe('admin_cms');
    });
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        CmsPagesController.prototype[method],
      );
      expect(meta).toBeUndefined();
    });
  });
});
