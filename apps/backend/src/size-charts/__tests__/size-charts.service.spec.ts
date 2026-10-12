import { Test, TestingModule } from '@nestjs/testing';
import { SizeChartsService } from '../size-charts.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('SizeChartsService.findByProductSlug (Fix 2)', () => {
  let svc: SizeChartsService;
  let prisma: {
    product: { findUnique: jest.Mock };
    sizeChart: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      product: { findUnique: jest.fn() },
      sizeChart: { findUnique: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [SizeChartsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = module.get<SizeChartsService>(SizeChartsService);
  });

  const activeChart = { id: 'c1', name: 'Guide', isActive: true, tableData: [] };
  const inactiveChart = { id: 'c2', name: 'Old', isActive: false, tableData: [] };

  it('returns the chart for direct product assignment', async () => {
    prisma.product.findUnique.mockResolvedValue({ sizeChartId: 'c1', category: null, productCategories: [] });
    prisma.sizeChart.findUnique.mockResolvedValue(activeChart);
    await expect(svc.findByProductSlug('p')).resolves.toEqual(activeChart);
  });

  it('hides inactive charts (product assignment)', async () => {
    prisma.product.findUnique.mockResolvedValue({ sizeChartId: 'c2', category: null, productCategories: [] });
    prisma.sizeChart.findUnique.mockResolvedValue(inactiveChart);
    await expect(svc.findByProductSlug('p')).resolves.toBeNull();
  });

  it('falls back to category assignment, still honoring isActive', async () => {
    prisma.product.findUnique.mockResolvedValue({
      sizeChartId: null,
      category: { sizeChartId: 'c1' },
      productCategories: [],
    });
    prisma.sizeChart.findUnique.mockResolvedValue(activeChart);
    await expect(svc.findByProductSlug('p')).resolves.toEqual(activeChart);

    prisma.sizeChart.findUnique.mockResolvedValue(inactiveChart);
    await expect(svc.findByProductSlug('p')).resolves.toBeNull();
  });

  it('returns null when nothing is assigned', async () => {
    prisma.product.findUnique.mockResolvedValue({ sizeChartId: null, category: null, productCategories: [] });
    await expect(svc.findByProductSlug('p')).resolves.toBeNull();
    expect(prisma.sizeChart.findUnique).not.toHaveBeenCalled();
  });

  it('throws NotFound for unknown slug', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(svc.findByProductSlug('ghost')).rejects.toThrow('Product not found');
  });
});
