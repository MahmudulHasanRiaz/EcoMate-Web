import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { FeedService } from './feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '@ecomate/feature-flags';

describe('FeedService', () => {
  let service: FeedService;
  let prisma: any;
  let featureFlags: any;

  const mockConfig = {
    id: 'cfg-1',
    tenantId: 'default',
    platform: 'meta',
    secureToken: 'abc123def456',
    isActive: true,
    excludeOutOfStock: false,
    minPriceFilter: null,
    lastFetchedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };

  const mockPrisma = {
    productFeedConfig: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    productFeedLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
    },
  };

  const mockFeatureFlags = {
    canUse: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FeatureFlagsService, useValue: mockFeatureFlags },
      ],
    }).compile();

    service = module.get(FeedService);
    prisma = module.get(PrismaService);
    featureFlags = module.get(FeatureFlagsService);
  });

  describe('validateToken', () => {
    it('should return config when valid token + active config + licensed', async () => {
      mockPrisma.productFeedConfig.findFirst.mockResolvedValue(mockConfig);
      mockFeatureFlags.canUse.mockReturnValue(true);

      const result = await service.validateToken('valid-token', 'meta');

      expect(result.config).toBeDefined();
      expect(result.config.id).toBe('cfg-1');
      expect(result.tenantId).toBe('default');
      expect(mockPrisma.productFeedConfig.findFirst).toHaveBeenCalledWith({
        where: { secureToken: 'valid-token', platform: 'meta', isActive: true },
      });
    });

    it('should throw NotFoundException when token invalid', async () => {
      mockPrisma.productFeedConfig.findFirst.mockResolvedValue(null);

      await expect(service.validateToken('bad-token', 'meta')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.validateToken('bad-token', 'meta')).rejects.toThrow(
        'Feed not found',
      );
    });

    it('should throw NotFoundException when config inactive', async () => {
      mockPrisma.productFeedConfig.findFirst.mockResolvedValue(null);

      await expect(
        service.validateToken('valid-token', 'meta'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when feature not licensed', async () => {
      mockPrisma.productFeedConfig.findFirst.mockResolvedValue(mockConfig);
      mockFeatureFlags.canUse.mockReturnValue(false);

      await expect(
        service.validateToken('valid-token', 'meta'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.validateToken('valid-token', 'meta'),
      ).rejects.toThrow('Feature is not licensed');
    });
  });

  describe('listConfigs', () => {
    it('should return all feed configs ordered by platform', async () => {
      mockPrisma.productFeedConfig.findMany.mockResolvedValue([mockConfig]);

      const result = await service.listConfigs();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cfg-1');
      expect(mockPrisma.productFeedConfig.findMany).toHaveBeenCalledWith({
        orderBy: { platform: 'asc' },
      });
    });

    it('should return empty array when no configs exist', async () => {
      mockPrisma.productFeedConfig.findMany.mockResolvedValue([]);

      const result = await service.listConfigs();

      expect(result).toHaveLength(0);
    });
  });

  describe('createConfig', () => {
    it('should create config with random 64-char hex token', async () => {
      mockPrisma.productFeedConfig.findFirst.mockResolvedValue(null);
      mockPrisma.productFeedConfig.create.mockResolvedValue({
        ...mockConfig,
        secureToken: 'a'.repeat(64),
      });

      const result = await service.createConfig({ platform: 'google' });

      expect(result.secureToken).toBe('a'.repeat(64));
      expect(mockPrisma.productFeedConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            platform: 'google',
            tenantId: 'default',
            secureToken: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        }),
      );
    });

    it('should throw BadRequestException if config for platform already exists', async () => {
      mockPrisma.productFeedConfig.findFirst.mockResolvedValue(mockConfig);

      await expect(service.createConfig({ platform: 'meta' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createConfig({ platform: 'meta' })).rejects.toThrow(
        'already exists',
      );
    });
  });

  describe('updateConfig', () => {
    it('should update config fields', async () => {
      const updated = { ...mockConfig, isActive: false };
      mockPrisma.productFeedConfig.update.mockResolvedValue(updated);

      const result = await service.updateConfig('cfg-1', { isActive: false });

      expect(result.isActive).toBe(false);
      expect(mockPrisma.productFeedConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg-1' },
        data: { isActive: false },
      });
    });

    it('should update multiple fields at once', async () => {
      const updated = {
        ...mockConfig,
        excludeOutOfStock: true,
        minPriceFilter: 500,
      };
      mockPrisma.productFeedConfig.update.mockResolvedValue(updated);

      const result = await service.updateConfig('cfg-1', {
        excludeOutOfStock: true,
        minPriceFilter: 500,
      });

      expect(result.excludeOutOfStock).toBe(true);
      expect(result.minPriceFilter).toBe(500);
      expect(mockPrisma.productFeedConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg-1' },
        data: { excludeOutOfStock: true, minPriceFilter: 500 },
      });
    });
  });

  describe('regenerateToken', () => {
    it('should generate new 64-char hex token and update', async () => {
      const updated = { ...mockConfig, secureToken: 'new-token-64-chars' };
      mockPrisma.productFeedConfig.update.mockResolvedValue(updated);

      const result = await service.regenerateToken('cfg-1');

      expect(result.secureToken).toBe('new-token-64-chars');
      expect(mockPrisma.productFeedConfig.update).toHaveBeenCalledWith({
        where: { id: 'cfg-1' },
        data: { secureToken: expect.stringMatching(/^[a-f0-9]{64}$/) },
      });
    });
  });

  describe('getLogs', () => {
    const mockLog = {
      id: 'log-1',
      tenantId: 'default',
      platform: 'meta',
      ipAddress: '0.0.0.0',
      userAgent: 'feed-generator',
      statusCode: 200,
      durationMs: 150,
      fetchedAt: new Date('2025-01-02'),
    };

    it('should return logs ordered by fetchedAt desc, limited to 100', async () => {
      mockPrisma.productFeedLog.findMany.mockResolvedValue([mockLog]);

      const result = await service.getLogs();

      expect(result).toHaveLength(1);
      expect(mockPrisma.productFeedLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { fetchedAt: 'desc' },
        take: 100,
      });
    });

    it('should filter by platform when provided', async () => {
      mockPrisma.productFeedLog.findMany.mockResolvedValue([mockLog]);

      const result = await service.getLogs('meta');

      expect(result).toHaveLength(1);
      expect(mockPrisma.productFeedLog.findMany).toHaveBeenCalledWith({
        where: { platform: 'meta' },
        orderBy: { fetchedAt: 'desc' },
        take: 100,
      });
    });

    it('should return empty array when no logs exist', async () => {
      mockPrisma.productFeedLog.findMany.mockResolvedValue([]);

      const result = await service.getLogs();

      expect(result).toHaveLength(0);
    });
  });
});
