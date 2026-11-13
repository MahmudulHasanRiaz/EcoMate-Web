import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RATE_LIMIT_POLICY_KEY } from '../../common/rate-limit/rate-limit-policy.interface';
import { SupportEnquiriesController } from '../support-enquiries.controller';

describe('SupportEnquiriesController', () => {
  it('create is public with the checkout rate-limit policy', () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, SupportEnquiriesController.prototype.create),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        RATE_LIMIT_POLICY_KEY,
        SupportEnquiriesController.prototype.create,
      ),
    ).toBe('checkout');
  });

  it.each(['findAll', 'findOne', 'update'])(
    'admin method %s requires a staff role and is not public',
    (method) => {
      const proto = SupportEnquiriesController.prototype as any;
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto[method])).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, proto[method])).toEqual([
        'superadmin',
        'admin',
        'employee',
      ]);
    },
  );
});
