import { Test, TestingModule } from '@nestjs/testing';
import { LicenseController } from '../license.controller';
import { LicenseService } from '../license.service';
import { LicenseActivationService } from '../license-activation.service';

describe('LicenseController', () => {
  let controller: LicenseController;
  let licenseService: LicenseService;

  const mockLicenseService = {
    getStatus: jest.fn(),
    activateWithKeymate: jest.fn(),
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

  it('activate endpoint calls licenseService.activateWithKeymate', async () => {
    const dto = { licenseKey: 'TEST-KEY' };
    const mockReq = { hostname: 'client-store.com' };
    const mockResult = { success: true, license: { valid: true } };
    mockLicenseService.activateWithKeymate.mockResolvedValue(mockResult);

    const result = await controller.activate(dto, mockReq as any);
    expect(result).toEqual(mockResult);
    expect(mockLicenseService.activateWithKeymate).toHaveBeenCalledWith(
      'TEST-KEY',
      'client-store.com',
      undefined,
    );
  });

  it('getStatus returns license status', () => {
    mockLicenseService.getStatus.mockReturnValue({ active: true });
    const result = controller.getStatus();
    expect(result).toEqual({ active: true });
  });
});
