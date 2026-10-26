import { Test, TestingModule } from '@nestjs/testing';
import { LicenseController } from '../license.controller';
import { LicenseService } from '../license.service';
import { LicenseActivationService } from '../license-activation.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';

describe('LicenseController', () => {
  let controller: LicenseController;
  let licenseService: LicenseService;

  const mockLicenseService = {
    getStatus: jest.fn(),
    activateWithKeymate: jest.fn(),
    sync: jest.fn(),
  };

  const mockActivationService = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LicenseController],
      providers: [
        { provide: LicenseService, useValue: mockLicenseService },
        { provide: LicenseActivationService, useValue: mockActivationService },
      ],
    }).compile();
    controller = module.get<LicenseController>(LicenseController);
    licenseService = module.get<LicenseService>(LicenseService);
  });

  it('activate endpoint calls licenseService.activateWithKeymate with the actor', async () => {
    const dto = { licenseKey: 'TEST-KEY' };
    const mockReq = {
      hostname: 'client-store.com',
      user: { userId: 'user-1' },
      ip: '203.0.113.9',
    };
    const mockResult = { success: true, license: { valid: true } };
    mockLicenseService.activateWithKeymate.mockResolvedValue(mockResult);

    const result = await controller.activate(dto, mockReq as any);
    expect(result).toEqual(mockResult);
    expect(mockLicenseService.activateWithKeymate).toHaveBeenCalledWith(
      'TEST-KEY',
      'client-store.com',
      undefined,
      'user-1',
      '203.0.113.9',
    );
  });

  it('activate normalises the hostname (lowercase, port stripped)', async () => {
    const dto = { licenseKey: 'TEST-KEY' };
    const mockReq = {
      hostname: 'Client-Store.Example.com:4000',
      user: { userId: 'user-1' },
      ip: '203.0.113.9',
    };
    mockLicenseService.activateWithKeymate.mockResolvedValue({
      success: true,
    });

    await controller.activate(dto, mockReq as any);
    expect(mockLicenseService.activateWithKeymate).toHaveBeenCalledWith(
      'TEST-KEY',
      'client-store.example.com',
      undefined,
      'user-1',
      '203.0.113.9',
    );
  });

  it('sync passes the current (normalised) hostname so a redeploy behind a new host can revalidate', async () => {
    const mockReq = { hostname: 'New-Host.Example.com:4000' };
    mockLicenseService.sync.mockResolvedValue({ success: true });

    await controller.sync(mockReq as any);
    expect(mockLicenseService.sync).toHaveBeenCalledWith(
      'new-host.example.com',
    );
  });

  it('getStatus returns license status', () => {
    mockLicenseService.getStatus.mockReturnValue({ active: true });
    const result = controller.getStatus();
    expect(result).toEqual({ active: true });
  });

  describe('authorization metadata', () => {
    /**
     * The activation endpoint used to be @Public(), which meant any anonymous
     * visitor who could reach the backend could overwrite the license of a
     * live deployment. These assertions are the regression guard for that.
     */
    it('requires an admin session to activate — not public', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        LicenseController.prototype.activate,
      );
      expect(permissions).toEqual(
        expect.arrayContaining(['manage_license']),
      );

      const isPublic = Reflect.getMetadata(
        IS_PUBLIC_KEY,
        LicenseController.prototype.activate,
      );
      expect(isPublic).toBeFalsy();
    });

    it('keeps the status endpoint public so the sign-in screen can render', () => {
      const isPublic = Reflect.getMetadata(
        IS_PUBLIC_KEY,
        LicenseController.prototype.getStatus,
      );
      expect(isPublic).toBe(true);
    });

    it('asks for license details only when the caller is an admin', () => {
      controller.getStatus({ role: 'admin' });
      expect(mockLicenseService.getStatus).toHaveBeenCalledWith({ includeDetails: true });

      mockLicenseService.getStatus.mockClear();
      controller.getStatus(undefined);
      expect(mockLicenseService.getStatus).toHaveBeenCalledWith({ includeDetails: false });
    });
  });
});
