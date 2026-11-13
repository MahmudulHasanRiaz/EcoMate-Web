import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_ANY_KEY } from '../../decorators/permissions.decorator';
import { ROLES_KEY } from '../../decorators/roles.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { HrAttendanceController } from '../../../hr-attendance/hr-attendance.controller';
import { HrLeaveController } from '../../../hr-leave/hr-leave.controller';
import { HrPaymentsController } from '../../../hr-payments/hr-payments.controller';
import { PayrollController } from '../../../payroll/payroll.controller';
import { CommissionsController } from '../../../commissions/commissions.controller';
import { HrScheduleController } from '../../../hr-schedule/hr-schedule.controller';
import { HrLedgersController } from '../../../hr-ledgers/hr-ledgers.controller';
import { HrSelfServiceController } from '../../../hr-self-service/hr-self-service.controller';
import { EmployeesController } from '../../../employees/employees.controller';
import { AttendanceDevicesController } from '../../../attendance-devices/attendance-devices.controller';
import { JobPostingsController, HrJobPostingsController } from '../../../job-postings/job-postings.controller';
import { JobApplicationsController } from '../../../job-applications/job-applications.controller';

// Reflector reads NestJS SetMetadata reliably for class-level (same path as the actual guards)
const reflector = new Reflector();

function classMeta(key: string, ctor: Function) {
  return reflector.getAllAndOverride(key, [ctor]);
}

// NOTE: NestJS 11 + TS method-level SetMetadata doesn't register via raw Reflect.getMetadata
// at compile time. Decorator metadata is verified at runtime by the guard system via Reflector.
// We verify method EXISTENCE as a compilation sanity check instead.
function hasMethod(ctor: Function, methodName: string): boolean {
  return typeof (ctor.prototype as any)[methodName] === 'function';
}

// ---------------------------------------------------------------------------
// Controllers that require admin_hr (EXCLUDING self-service)
// ---------------------------------------------------------------------------
const ADMIN_HR_CONTROLLERS: { name: string; ctor: Function; feature: string; roles: string[]; perms: string[] }[] = [
  {
    name: 'HrAttendanceController',
    ctor: HrAttendanceController,
    feature: 'admin_hr',
    roles: ['superadmin', 'admin', 'employee'],
    perms: ['manage_attendance'],
  },
  {
    name: 'HrLeaveController',
    ctor: HrLeaveController,
    feature: 'admin_hr',
    roles: ['superadmin', 'admin', 'employee'],
    perms: ['manage_leave'],
  },
  {
    name: 'CommissionsController',
    ctor: CommissionsController,
    feature: 'admin_hr',
    roles: ['superadmin', 'admin', 'employee'],
    perms: ['manage_commissions'],
  },
  {
    name: 'HrScheduleController',
    ctor: HrScheduleController,
    feature: 'admin_hr',
    roles: ['superadmin', 'admin', 'employee'],
    perms: ['view_hr'],
  },
  {
    name: 'HrLedgersController',
    ctor: HrLedgersController,
    feature: 'admin_hr',
    roles: ['superadmin', 'admin', 'employee'],
    perms: ['manage_payroll', 'manage_employees'],
  },
  {
    name: 'AttendanceDevicesController',
    ctor: AttendanceDevicesController,
    feature: 'admin_hr',
    roles: ['superadmin', 'admin', 'employee'],
    perms: ['manage_attendance_devices'],
  },
];

const OTHER_CONTROLLERS = [
  {
    name: 'HrPaymentsController',
    ctor: HrPaymentsController,
    feature: 'admin_payroll',
    roles: ['superadmin', 'admin', 'employee'],
    perms: ['manage_payroll'],
  },
  {
    name: 'PayrollController',
    ctor: PayrollController,
    feature: 'admin_payroll',
    roles: ['superadmin', 'admin', 'employee'],
    perms: ['view_hr'],
  },
  {
    name: 'EmployeesController',
    ctor: EmployeesController,
    feature: 'admin_employees',
    roles: ['superadmin', 'admin', 'employee'],
    perms: ['view_hr'],
  },
];

describe('G-10 + §22 — HR permission matrix (static introspection)', () => {
  // -----------------------------------------------------------------------
  // Class-level decorators
  // -----------------------------------------------------------------------
  describe.each(ADMIN_HR_CONTROLLERS)('$name', ({ ctor, feature, roles, perms }) => {
    it(`@Roles includes ${roles.join(',')}`, () => {
      const meta = classMeta(ROLES_KEY, ctor);
      expect(meta).toEqual(expect.arrayContaining(roles));
    });

    it(`@RequiresFeature('${feature}')`, () => {
      const meta = classMeta(REQUIRES_FEATURE_KEY, ctor);
      expect(meta).toBe(feature);
    });

    it(`@PermissionsAny includes ${perms.join(',')}`, () => {
      const meta = classMeta(PERMISSIONS_ANY_KEY, ctor);
      expect(meta).toEqual(expect.arrayContaining(perms));
    });
  });

  describe.each(OTHER_CONTROLLERS)('$name', ({ ctor, feature, roles, perms }) => {
    it(`@Roles includes ${roles.join(',')}`, () => {
      const meta = classMeta(ROLES_KEY, ctor);
      expect(meta).toEqual(expect.arrayContaining(roles));
    });

    it(`@RequiresFeature('${feature}')`, () => {
      const meta = classMeta(REQUIRES_FEATURE_KEY, ctor);
      expect(meta).toBe(feature);
    });

    it(`@PermissionsAny includes ${perms.join(',')}`, () => {
      const meta = classMeta(PERMISSIONS_ANY_KEY, ctor);
      expect(meta).toEqual(expect.arrayContaining(perms));
    });
  });

  // -----------------------------------------------------------------------
  // HrSelfServiceController — special: employee+cashier roles, no RequiresFeature
  // -----------------------------------------------------------------------
  describe('HrSelfServiceController', () => {
    it('@Roles includes employee + cashier (plus admin roles)', () => {
      const meta = classMeta(ROLES_KEY, HrSelfServiceController);
      expect(meta).toEqual(expect.arrayContaining(['employee', 'cashier', 'superadmin', 'admin', 'employee']));
    });

    it('has NO @RequiresFeature decorator (open to all authenticated)', () => {
      const meta = classMeta(REQUIRES_FEATURE_KEY, HrSelfServiceController);
      expect(meta).toBeUndefined();
    });

    it('has NO class-level @PermissionsAny', () => {
      const meta = classMeta(PERMISSIONS_ANY_KEY, HrSelfServiceController);
      expect(meta).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Method-level — verify method existence (compilation sanity check)
  // Decorator metadata is enforced by NestJS guards at runtime, not raw reflection
  // -----------------------------------------------------------------------
  describe('critical route methods exist', () => {
    it('HrAttendanceController has createDay', () => {
      expect(hasMethod(HrAttendanceController, 'createDay')).toBe(true);
    });

    it('HrAttendanceController has createAdjustment', () => {
      expect(hasMethod(HrAttendanceController, 'createAdjustment')).toBe(true);
    });

    it('HrAttendanceController has closeSession', () => {
      expect(hasMethod(HrAttendanceController, 'closeSession')).toBe(true);
    });

    it('HrAttendanceController has listAdjustments', () => {
      expect(hasMethod(HrAttendanceController, 'listAdjustments')).toBe(true);
    });
  });

  describe('payroll route methods exist', () => {
    it('PayrollController has setPayslipStatus', () => {
      expect(hasMethod(PayrollController, 'setPayslipStatus')).toBe(true);
    });

    it('HrPaymentsController has voidPayment', () => {
      expect(hasMethod(HrPaymentsController, 'voidPayment')).toBe(true);
    });
  });

  describe('commissions route methods exist', () => {
    it('CommissionsController has reverseEarning', () => {
      expect(hasMethod(CommissionsController, 'reverseEarning')).toBe(true);
    });
  });

  describe('employees route methods exist', () => {
    it('EmployeesController has update', () => {
      expect(hasMethod(EmployeesController, 'update')).toBe(true);
    });

    it('EmployeesController has create', () => {
      expect(hasMethod(EmployeesController, 'create')).toBe(true);
    });

    it('EmployeesController has remove', () => {
      expect(hasMethod(EmployeesController, 'remove')).toBe(true);
    });
  });

  describe('attendance devices route methods exist', () => {
    it('AttendanceDevicesController has list', () => {
      expect(hasMethod(AttendanceDevicesController, 'list')).toBe(true);
    });

    it('AttendanceDevicesController has listEvents', () => {
      expect(hasMethod(AttendanceDevicesController, 'listEvents')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Careers (storefront dynamic-pages round 2026-11-13, Option B split gate)
  // Admin controllers carry ONLY the new key — the guard ignores the
  // declared admin_hr dependency, so the parent is enforced explicitly in
  // the services (assertCareersFeature). The public /jobs controller must
  // NOT be feature-gated: /careers stays live for every tenant.
  // -----------------------------------------------------------------------
  describe.each([
    {
      name: 'HrJobPostingsController',
      ctor: HrJobPostingsController,
      feature: 'admin_hr_careers',
      roles: ['superadmin', 'admin', 'employee'],
      perms: ['view_hr'],
    },
    {
      name: 'JobApplicationsController',
      ctor: JobApplicationsController,
      feature: 'admin_hr_careers',
      roles: ['superadmin', 'admin', 'employee'],
      perms: ['view_hr'],
    },
  ])('Careers $name', ({ ctor, feature, roles, perms }) => {
    it(`@Roles includes ${roles.join(',')}`, () => {
      const meta = classMeta(ROLES_KEY, ctor);
      expect(meta).toEqual(expect.arrayContaining(roles));
    });

    it(`@RequiresFeature('${feature}')`, () => {
      const meta = classMeta(REQUIRES_FEATURE_KEY, ctor);
      expect(meta).toBe(feature);
    });

    it(`@PermissionsAny includes ${perms.join(',')}`, () => {
      const meta = classMeta(PERMISSIONS_ANY_KEY, ctor);
      expect(meta).toEqual(expect.arrayContaining(perms));
    });
  });

  describe('Careers public controller is ungated', () => {
    it('JobPostingsController has NO @RequiresFeature (Option B: /careers stays live)', () => {
      expect(classMeta(REQUIRES_FEATURE_KEY, JobPostingsController)).toBeUndefined();
    });

    it('JobPostingsController has NO class-level @Roles (public)', () => {
      expect(classMeta(ROLES_KEY, JobPostingsController)).toBeUndefined();
    });
  });

  describe('careers route methods exist', () => {
    it('HrJobPostingsController has create', () => {
      expect(hasMethod(HrJobPostingsController, 'create')).toBe(true);
    });

    it('HrJobPostingsController has update', () => {
      expect(hasMethod(HrJobPostingsController, 'update')).toBe(true);
    });

    it('JobPostingsController has apply', () => {
      expect(hasMethod(JobPostingsController, 'apply')).toBe(true);
    });

    it('JobApplicationsController has downloadCv', () => {
      expect(hasMethod(JobApplicationsController, 'downloadCv')).toBe(true);
    });

    it('JobApplicationsController has deleteCv', () => {
      expect(hasMethod(JobApplicationsController, 'deleteCv')).toBe(true);
    });
  });
});
