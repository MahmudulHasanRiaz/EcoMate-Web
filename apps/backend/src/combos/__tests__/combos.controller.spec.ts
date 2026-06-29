import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { CombosController } from '../combos.controller';

describe('CombosController', () => {
  const adminMethods = ['create', 'update', 'remove'];

  const publicMethods = ['findAll', 'findOne'];

  describe('admin methods', () => {
    it.each(adminMethods)('adds RequiresFeature(admin_combos) on %s', (method) => {
      const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, CombosController.prototype[method]);
      expect(meta).toBe('admin_combos');
    });
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(REQUIRES_FEATURE_KEY, CombosController.prototype[method]);
      expect(meta).toBeUndefined();
    });
  });
});
