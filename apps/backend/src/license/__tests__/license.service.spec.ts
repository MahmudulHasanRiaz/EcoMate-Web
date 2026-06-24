import { Test, TestingModule } from '@nestjs/testing';
import { LicenseService } from '../license.service';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { ConfigService } from '@nestjs/config';

describe('LicenseService', () => {
  let service: LicenseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LicenseService,
        {
          provide: FeatureFlagsService,
          useFactory: () => new FeatureFlagsService(),
        },
        {
          provide: ConfigService,
          useValue: { get: () => null },
        },
      ],
    }).compile();

    service = module.get<LicenseService>(LicenseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getStatus returns active property', () => {
    const status = service.getStatus();
    expect(status).toHaveProperty('active');
  });
});
