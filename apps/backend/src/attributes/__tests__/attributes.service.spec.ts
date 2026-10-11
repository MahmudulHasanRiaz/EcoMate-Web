import { Test, TestingModule } from '@nestjs/testing';
import { AttributesService } from '../attributes.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AttributesService (swatch image)', () => {
  let svc: AttributesService;
  let prisma: {
    attribute: { findUnique: jest.Mock; update: jest.Mock };
    attributeValue: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      attribute: { findUnique: jest.fn(), update: jest.fn() },
      attributeValue: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttributesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = module.get<AttributesService>(AttributesService);
  });

  it('persists image on addValue', async () => {
    prisma.attribute.findUnique.mockResolvedValue({ id: 'a1' });
    prisma.attributeValue.findFirst.mockResolvedValue(null);
    prisma.attributeValue.create.mockResolvedValue({ id: 'v1' });

    await svc.addValue('a1', { value: 'Black', image: '/sw/black.jpg' });

    expect(prisma.attributeValue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ value: 'Black', image: '/sw/black.jpg' }),
    });
  });

  it('updates hex + image on updateValue, 404 on unknown id', async () => {
    prisma.attributeValue.findUnique.mockResolvedValue({ id: 'v1' });
    prisma.attributeValue.update.mockResolvedValue({ id: 'v1' });

    await svc.updateValue('v1', { image: '/sw/b.jpg' });
    expect(prisma.attributeValue.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { image: '/sw/b.jpg' },
    });

    prisma.attributeValue.findUnique.mockResolvedValue(null);
    await expect(svc.updateValue('nope', {})).rejects.toThrow(
      'Attribute value not found',
    );
  });

  it('rejects invalid swatchFit on attribute update', async () => {
    prisma.attribute.findUnique.mockResolvedValue({ id: 'a1' });
    await expect(svc.update('a1', { swatchFit: 'stretch' } as any)).rejects.toThrow(
      'swatchFit must be cover or contain',
    );
    expect(prisma.attribute.update).not.toHaveBeenCalled();
  });

  it('persists valid swatchFit', async () => {
    prisma.attribute.findUnique.mockResolvedValue({ id: 'a1' });
    prisma.attribute.update.mockResolvedValue({ id: 'a1' });
    await svc.update('a1', { swatchFit: 'contain' });
    expect(prisma.attribute.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { swatchFit: 'contain' },
    });
  });
});
