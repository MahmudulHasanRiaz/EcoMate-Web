import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { SizeChartsController } from '../size-charts.controller';

describe('SizeChartsController', () => {
  const adminMethods = ['findAll', 'findOne', 'create', 'update', 'remove'];

  const publicMethods = ['findByProductSlug'];

  describe('admin methods', () => {
    it.each(adminMethods)(
      'adds RequiresFeature(admin_size_charts) on %s',
      (method) => {
        const meta = Reflect.getMetadata(
          REQUIRES_FEATURE_KEY,
          SizeChartsController.prototype[method],
        );
        expect(meta).toBe('admin_size_charts');
      },
    );
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        SizeChartsController.prototype[method],
      );
      expect(meta).toBeUndefined();
    });
  });
});
