import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { DualModeAuthGuard } from './dual-mode-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { getAllPermissions } from '../permissions/registry';

jest.mock('../../better-auth/auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock('better-auth/node', () => ({
  fromNodeHeaders: jest.fn(() => ({})),
}));

import { auth } from '../../better-auth/auth.config';

describe('DualModeAuthGuard — JWT path permissions via computeEffectivePermissions', () => {
  let guard: DualModeAuthGuard;
  let prisma: PrismaService;

  const mockJwt = {
    verifyAsync: jest.fn(),
  };

  const makeContext = (authorization?: string) => {
    const request: any = { headers: { authorization } };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (auth.api.getSession as jest.Mock).mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        DualModeAuthGuard,
        Reflector,
        { provide: JwtService, useValue: mockJwt },
        {
          provide: PrismaService,
          useValue: {
            userProfile: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
            },
            userSettings: { create: jest.fn() },
            betterAuthUser: { findUnique: jest.fn() },
          },
        },
      ],
    }).compile();
    guard = module.get<DualModeAuthGuard>(DualModeAuthGuard);
    prisma = module.get<PrismaService>(PrismaService);
    mockJwt.verifyAsync.mockResolvedValue({ sub: 'user-1' });
  });

  it('admin JWT user gets ALL registered permissions without a BA query', async () => {
    (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-1',
      role: 'admin',
      status: 'active',
      betterAuthUserId: 'ba-1',
    });

    const context = makeContext('Bearer token-1');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(context.switchToHttp().getRequest().user.permissions).toEqual(
      getAllPermissions(),
    );
    expect(prisma.betterAuthUser.findUnique).not.toHaveBeenCalled();
  });

  it('employee JWT user with employee link gets preset ∪ override permissions', async () => {
    (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-1',
      role: 'employee',
      status: 'active',
      betterAuthUserId: 'ba-1',
    });
    (prisma.betterAuthUser.findUnique as jest.Mock).mockResolvedValue({
      override_permissions: ['view_orders', 'ghost_key'],
      employee: {
        accessPreset: { permissions: ['view_customers'] },
      },
    });

    const context = makeContext('Bearer token-1');
    await guard.canActivate(context);

    expect(prisma.betterAuthUser.findUnique).toHaveBeenCalledWith({
      where: { id: 'ba-1' },
      select: {
        override_permissions: true,
        employee: { include: { accessPreset: true } },
      },
    });
    const req = context.switchToHttp().getRequest();
    expect(req.user.permissions).toEqual(['view_customers', 'view_orders']);
    expect(req.user.userId).toBe('user-1');
  });

  it('employee JWT user without betterAuthUserId gets [] and no BA query (no throw)', async () => {
    (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-1',
      role: 'employee',
      status: 'active',
      betterAuthUserId: null,
    });

    const context = makeContext('Bearer token-1');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(context.switchToHttp().getRequest().user.permissions).toEqual([]);
    expect(prisma.betterAuthUser.findUnique).not.toHaveBeenCalled();
  });

  it('customer JWT user gets [] even if BA row exists', async () => {
    (prisma.userProfile.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-1',
      role: 'customer',
      status: 'active',
      betterAuthUserId: 'ba-1',
    });
    (prisma.betterAuthUser.findUnique as jest.Mock).mockResolvedValue({
      override_permissions: [],
      employee: null,
    });

    const context = makeContext('Bearer token-1');
    await guard.canActivate(context);

    expect(context.switchToHttp().getRequest().user.permissions).toEqual([]);
  });

  it('BA session path keeps session.user.permissions on request.user (unchanged)', async () => {
    (auth.api.getSession as jest.Mock).mockResolvedValue({
      user: { id: 'ba-1', role: 'employee', permissions: ['view_orders'] },
      session: { id: 's-1' },
    });
    (prisma.userProfile.findFirst as jest.Mock).mockResolvedValue({
      id: 'user-1',
      role: 'employee',
      status: 'active',
      betterAuthUserId: 'ba-1',
    });

    const context = makeContext();
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    const req = context.switchToHttp().getRequest();
    expect(req.user.permissions).toEqual(['view_orders']);
    expect(req.user.betterAuthSession).toBeDefined();
  });
});