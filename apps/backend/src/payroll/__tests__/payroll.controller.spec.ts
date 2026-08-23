import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { PayrollController } from '../payroll.controller';
import { PayrollService } from '../payroll.service';

describe('PayrollController', () => {
  it('has RequiresFeature(admin_payroll) metadata', () => {
    const featureKey = Reflect.getMetadata(
      REQUIRES_FEATURE_KEY,
      PayrollController,
    );
    expect(featureKey).toBe('admin_payroll');
  });

  it('passes periodKey query along with pagination to the service', () => {
    const service = {
      findAllPayslips: jest.fn().mockResolvedValue({
        data: [],
        meta: { total: 0, page: 2, perPage: 20, totalPages: 0 },
      }),
    };
    const controller = new PayrollController(
      service as unknown as PayrollService,
    );

    controller.findAllPayslips('2', '20', '2026-08');

    expect(service.findAllPayslips).toHaveBeenCalledWith(2, 20, '2026-08');
  });
});