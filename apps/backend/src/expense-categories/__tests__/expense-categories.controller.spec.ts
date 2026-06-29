import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ExpenseCategoriesController } from '../expense-categories.controller';

describe('ExpenseCategoriesController', () => {
  it('has RequiresFeature(admin_expenses) metadata', () => {
    const featureKey = Reflect.getMetadata(REQUIRES_FEATURE_KEY, ExpenseCategoriesController);
    expect(featureKey).toBe('admin_expenses');
  });
});
