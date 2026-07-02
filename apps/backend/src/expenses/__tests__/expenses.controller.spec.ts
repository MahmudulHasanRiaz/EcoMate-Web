import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ExpensesController } from '../expenses.controller';

describe('ExpensesController', () => {
  it('has RequiresFeature(admin_expenses) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      ExpensesController,
    );
    expect(featureKey).toBe('admin_expenses');
  });
});
