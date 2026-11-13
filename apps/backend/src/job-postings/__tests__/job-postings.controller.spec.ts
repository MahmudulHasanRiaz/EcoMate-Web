import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PERMISSIONS_ANY_KEY } from '../../common/decorators/permissions.decorator';
import {
  JobPostingsController,
  HrJobPostingsController,
} from '../job-postings.controller';

describe('JobPostingsController (public /jobs)', () => {
  it('has NO @RequiresFeature metadata (public reads stay ungated — Option B)', () => {
    expect(
      Reflect.getMetadata(REQUIRES_FEATURE_KEY, JobPostingsController),
    ).toBeUndefined();
  });

  it('has NO class-level @Roles metadata (public)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, JobPostingsController)).toBeUndefined();
  });

  it('exposes listPublic / findPublic / apply', () => {
    expect(typeof JobPostingsController.prototype.listPublic).toBe('function');
    expect(typeof JobPostingsController.prototype.findPublic).toBe('function');
    expect(typeof JobPostingsController.prototype.apply).toBe('function');
  });
});

describe('HrJobPostingsController (admin /hr/job-postings)', () => {
  it("has @RequiresFeature('admin_hr_careers')", () => {
    expect(
      Reflect.getMetadata(REQUIRES_FEATURE_KEY, HrJobPostingsController),
    ).toBe('admin_hr_careers');
  });

  it("has @Roles('superadmin','admin','employee')", () => {
    expect(Reflect.getMetadata(ROLES_KEY, HrJobPostingsController)).toEqual([
      'superadmin',
      'admin',
      'employee',
    ]);
  });

  it("has @PermissionsAny('view_hr')", () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, HrJobPostingsController),
    ).toEqual(expect.arrayContaining(['view_hr']));
  });

  it('exposes list / findOne / create / update', () => {
    for (const m of ['list', 'findOne', 'create', 'update']) {
      expect(typeof (HrJobPostingsController.prototype as any)[m]).toBe(
        'function',
      );
    }
  });
});
