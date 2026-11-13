import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { StoreLocationsService } from '../store-locations.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('StoreLocationsService', () => {
  let service: StoreLocationsService;
  let prisma: any;

  const active = {
    id: 'a1',
    name: 'Dhaka Showroom',
    type: 'SHOWROOM',
    address: 'Bashundhara City, Dhaka',
    isActive: true,
    sortOrder: 0,
  };
  const inactive = { ...active, id: 'a2', name: 'Closed Branch', isActive: false };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreLocationsService,
        {
          provide: PrismaService,
          useValue: {
            storeLocation: {
              findMany: jest.fn().mockResolvedValue([active]),
              findFirst: jest.fn().mockResolvedValue(active),
              findUnique: jest.fn().mockResolvedValue(active),
              create: jest
                .fn()
                .mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data })),
              update: jest
                .fn()
                .mockImplementation(({ data }) => Promise.resolve({ ...active, ...data })),
              delete: jest.fn().mockResolvedValue(active),
            },
          },
        },
      ],
    }).compile();

    service = module.get<StoreLocationsService>(StoreLocationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAllPublic', () => {
    it('returns active locations only, sorted by sortOrder', async () => {
      const rows = await service.findAllPublic();
      expect(rows).toEqual([active]);
      expect(prisma.storeLocation.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('findOnePublic', () => {
    it('404s when the location is inactive or missing', async () => {
      prisma.storeLocation.findFirst.mockResolvedValueOnce(null);
      await expect(service.findOnePublic('a2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.storeLocation.findFirst).toHaveBeenCalledWith({
        where: { id: 'a2', isActive: true },
      });
    });
  });

  describe('findAllAdmin', () => {
    it('does not filter on isActive', async () => {
      prisma.storeLocation.findMany.mockResolvedValueOnce([active, inactive]);
      const rows = await service.findAllAdmin();
      expect(rows).toHaveLength(2);
      expect(prisma.storeLocation.findMany).toHaveBeenCalledWith({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      });
    });
  });

  describe('create', () => {
    it('normalises blank strings to null and drops empty social rows', async () => {
      const created = await service.create({
        name: 'New Branch',
        type: 'BRANCH',
        address: 'Somewhere',
        phone: '',
        mapUrl: 'https://maps.app.goo.gl/abc123',
        socials: [
          { platform: 'Facebook', url: 'https://facebook.com/shop' },
          { platform: '', url: '' },
        ],
        openingDate: '2026-12-01',
      } as any);
      expect(created.phone).toBeNull();
      expect(created.socials).toEqual([
        { platform: 'Facebook', url: 'https://facebook.com/shop' },
      ]);
      expect(created.openingDate).toEqual(new Date('2026-12-01'));
    });
  });

  describe('update', () => {
    it('404s for an unknown id', async () => {
      prisma.storeLocation.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.update('nope', { name: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storeLocation.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('hard-deletes (no other model references a store location)', async () => {
      const res = await service.remove('a1');
      expect(prisma.storeLocation.delete).toHaveBeenCalledWith({
        where: { id: 'a1' },
      });
      expect(res).toEqual({ message: 'Store location deleted' });
    });

    it('404s for an unknown id', async () => {
      prisma.storeLocation.findUnique.mockResolvedValueOnce(null);
      await expect(service.remove('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.storeLocation.delete).not.toHaveBeenCalled();
    });
  });
});
