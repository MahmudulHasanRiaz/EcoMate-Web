import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PERMISSIONS_ANY_KEY } from '../common/decorators/permissions.decorator';
import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

describe('HrController', () => {
  let controller: HrController;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HrController],
      providers: [
        { provide: HrService, useValue: { getOverview: jest.fn() } },
      ],
    }).compile();

    controller = module.get(HrController);
    reflector = module.get(Reflector);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should require superadmin/admin/manager roles at class level', () => {
    const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      HrController,
    ]);
    expect(roles).toEqual(['superadmin', 'admin', 'manager']);
  });

  it('should require view_hr permission at class level', () => {
    const perms = reflector.getAllAndOverride<string[]>(
      PERMISSIONS_ANY_KEY,
      [HrController],
    );
    expect(perms).toEqual(['view_hr']);
  });

  it('should require admin_hr feature at class level', () => {
    const feature = reflector.getAllAndOverride<string>(REQUIRES_FEATURE_KEY, [
      HrController,
    ]);
    expect(feature).toBe('admin_hr');
  });

  it('should expose GET /hr/overview', () => {
    const path = Reflect.getMetadata('path', HrController.prototype.getOverview);
    expect(path).toBe('overview');
    const method = Reflect.getMetadata('method', HrController.prototype.getOverview);
    expect(method).toBe(0); // GET
  });
});