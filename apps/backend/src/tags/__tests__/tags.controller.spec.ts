import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { TagsController } from '../tags.controller';

describe('TagsController', () => {
  const adminMethods = ['findAll', 'findOne', 'create', 'update', 'remove', 'bulkDelete', 'merge'];

  const publicMethods = ['findAllPublic'];

  describe('admin methods', () => {
    it.each(adminMethods)('adds RequiresFeature(admin_tags) on %s', (method) => {
      const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, TagsController.prototype[method]);
      expect(meta).toBe('admin_tags');
    });
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, TagsController.prototype[method]);
      expect(meta).toBeUndefined();
    });
  });
});
