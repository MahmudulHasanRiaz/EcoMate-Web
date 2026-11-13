import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PERMISSIONS_ANY_KEY } from '../../common/decorators/permissions.decorator';
import { JobApplicationsController } from '../job-applications.controller';

describe('JobApplicationsController (admin /hr/job-applications)', () => {
  it("has @RequiresFeature('admin_hr_careers')", () => {
    expect(
      Reflect.getMetadata(REQUIRES_FEATURE_KEY, JobApplicationsController),
    ).toBe('admin_hr_careers');
  });

  it("has @Roles('superadmin','admin','employee')", () => {
    expect(Reflect.getMetadata(ROLES_KEY, JobApplicationsController)).toEqual([
      'superadmin',
      'admin',
      'employee',
    ]);
  });

  it("has @PermissionsAny('view_hr')", () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, JobApplicationsController),
    ).toEqual(expect.arrayContaining(['view_hr']));
  });

  it('exposes list / findOne / downloadCv / update / deleteCv', () => {
    for (const m of ['list', 'findOne', 'downloadCv', 'update', 'deleteCv']) {
      expect(typeof (JobApplicationsController.prototype as any)[m]).toBe(
        'function',
      );
    }
  });
});
