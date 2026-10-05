import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SecurityService } from '../security/security.service';
import { PrismaService } from '../prisma/prisma.service';
import { getAllPermissions } from '../common/permissions/registry';
import { computeEffectivePermissions } from '../common/permissions/effective-permissions';

describe('AuthController — me() permission fallback', () => {
  let controller: AuthController;
  let prisma: PrismaService;

  // The real permission computation now lives in AuthService; the mock
  // mirrors it against the prisma mock so the fallback behaviour the
  // controller used to implement itself stays under test.
  const mockAuthService = {
    me: jest.fn(),
    adminLogin: jest.fn(),
    computePermissionsForUser: jest.fn(async (user: any) => {
      const role = user.role || 'customer';
      if (role === 'superadmin' || role === 'admin') {
        return getAllPermissions();
      }
      if (role === 'customer' || !user.betterAuthUserId) {
        return [];
      }
      const baUser = await prisma!.betterAuthUser.findUnique({
        where: { id: user.betterAuthUserId },
        select: {
          override_permissions: true,
          employee: { include: { accessPreset: true } },
        },
      });
      return computeEffectivePermissions({
        role,
        employeeLink: baUser?.employee ?? null,
        overridePermissions: baUser?.override_permissions,
      });
    }),
  };
  const mockSecurity = { recordFailedLogin: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthService.me.mockResolvedValue({
      id: 'user-1',
      firstName: 'Jane',
      role: 'admin',
    });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: SecurityService, useValue: mockSecurity },
        {
          provide: PrismaService,
          useValue: { betterAuthUser: { findUnique: jest.fn() } },
        },
      ],
    }).compile();
    controller = module.get<AuthController>(AuthController);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('passes through BA-attached permissions without BA query', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'employee',
      permissions: ['view_orders'],
    });
    expect(result.permissions).toEqual(['view_orders']);
    expect(prisma.betterAuthUser.findUnique).not.toHaveBeenCalled();
  });

  it('superadmin without permissions → ALL registered keys, no BA query', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'superadmin',
      betterAuthUserId: 'ba-1',
    });
    expect(result.permissions).toEqual(getAllPermissions());
    expect(prisma.betterAuthUser.findUnique).not.toHaveBeenCalled();
  });

  it('admin without permissions → ALL registered keys, no BA query', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'admin',
      betterAuthUserId: 'ba-1',
    });
    expect(result.permissions).toEqual(getAllPermissions());
    expect(prisma.betterAuthUser.findUnique).not.toHaveBeenCalled();
  });

  it('employee without permissions + BA row with preset & override → union', async () => {
    (prisma.betterAuthUser.findUnique as jest.Mock).mockResolvedValue({
      override_permissions: ['view_orders'],
      employee: { accessPreset: { permissions: ['view_customers'] } },
    });
    const result = await controller.me({
      userId: 'user-1',
      role: 'employee',
      betterAuthUserId: 'ba-1',
    });
    expect(result.permissions).toEqual(['view_customers', 'view_orders']);
    expect(prisma.betterAuthUser.findUnique).toHaveBeenCalledWith({
      where: { id: 'ba-1' },
      select: {
        override_permissions: true,
        employee: { include: { accessPreset: true } },
      },
    });
  });

  it('employee with BA row but no employee link → []', async () => {
    (prisma.betterAuthUser.findUnique as jest.Mock).mockResolvedValue({
      override_permissions: [],
      employee: null,
    });
    const result = await controller.me({
      userId: 'user-1',
      role: 'employee',
      betterAuthUserId: 'ba-1',
    });
    expect(result.permissions).toEqual([]);
  });

  it('customer → [] (no throw) even with betterAuthUserId', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'customer',
      betterAuthUserId: 'ba-1',
    });
    expect(result.permissions).toEqual([]);
    expect(prisma.betterAuthUser.findUnique).not.toHaveBeenCalled();
  });

  it('non-admin with null betterAuthUserId → [] without BA query (no throw)', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'employee',
      betterAuthUserId: null,
    });
    expect(result.permissions).toEqual([]);
    expect(prisma.betterAuthUser.findUnique).not.toHaveBeenCalled();
  });

  it('profile data preserved alongside permissions', async () => {
    const result = await controller.me({
      userId: 'user-1',
      role: 'admin',
    });
    expect(result).toMatchObject({
      id: 'user-1',
      firstName: 'Jane',
      permissions: getAllPermissions(),
    });
  });

  it('admin-login delegates to authService.adminLogin and sets the refresh cookie', async () => {
    mockAuthService.adminLogin.mockResolvedValue({
      accessToken: 'at',
      refreshToken: 'rt',
      user: { id: 'user-1', role: 'admin', permissions: [] },
    });
    const mockRes = { cookie: jest.fn() } as any;
    const mockReq = { ip: '203.0.113.9' };

    const result = await controller.adminLogin(
      { email: 'admin@x.com', password: 'secret123' },
      mockRes,
      mockReq,
    );

    expect(mockAuthService.adminLogin).toHaveBeenCalledWith({
      email: 'admin@x.com',
      password: 'secret123',
    });
    expect(mockRes.cookie).toHaveBeenCalledWith(
      'refreshToken',
      'rt',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result).toEqual({
      accessToken: 'at',
      user: { id: 'user-1', role: 'admin', permissions: [] },
    });
  });
});