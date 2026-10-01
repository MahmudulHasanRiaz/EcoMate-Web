/**
 * POS "See where" — product-level availability across the warehouse network.
 *
 * Regression coverage for the production bug where the alternative-location
 * lookup filtered on the exact `variantId` and therefore returned nothing
 * whenever a warehouse held the product under a sibling variant. On the
 * production site 99/99 affected products were variable products with NO
 * showroom row at all, so every candidate row was excluded and the UI claimed
 * "no location has stock" while the godown was full.
 *
 * "Where else can this product be found?" is a product-level question, so the
 * lookup aggregates at product level; exact-variant detail is surfaced
 * separately because a transfer is variant-precise.
 */
import { Test } from '@nestjs/testing';
import { PosOrdersService } from '../pos-orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../../stock/stock.service';
import { StockRouterService } from '../../stock/stock-router.service';
import { TrackingCaptureService } from '../../tracking/tracking-capture.service';
import { TrackingSettingsService } from '../../tracking/tracking-settings.service';
import { CommissionsService } from '../../commissions/commissions.service';
import { CustomerAddressService } from '../../customers/customer-address.service';
import { SalesChannelService } from '../../sales-channel/sales-channel.service';
import { MediaResolverService } from '../../media/media-resolver.service';
import { ConfigService } from '@nestjs/config';

const SHOWROOM = 'showroom-1';
const GODOWN = 'godown-1';
const PRODUCT = 'product-1';
const VARIANT_A = 'variant-a';
const VARIANT_B = 'variant-b';

const wh = (id: string, type: string) => ({ id, name: id, type });

describe('PosOrdersService.getProductAvailability — network lookup', () => {
  let service: PosOrdersService;
  let prisma: any;

  const row = (
    warehouseId: string,
    variantId: string | null,
    quantity: number,
    reservedQuantity = 0,
  ) => ({
    quantity,
    reservedQuantity,
    variantId,
    warehouse: wh(warehouseId, warehouseId === SHOWROOM ? 'showroom' : 'main'),
  });

  async function build(physicalRows: any[], showroomStock = 0) {
    prisma = {
      physicalInventory: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          // Mirror the real query: productId, warehouseId != showroom, qty > 0.
          return physicalRows.filter(
            (r) =>
              where.productId === PRODUCT &&
              r.warehouse.id !== where.warehouseId.not &&
              r.quantity > (where.quantity?.gt ?? 0),
          );
        }),
      },
      orderCounter: { upsert: jest.fn() },
    } as any;

    const moduleRef = await Test.createTestingModule({
      providers: [
        PosOrdersService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StockService,
          useValue: {
            checkPhysicalAvailability: jest
              .fn()
              .mockResolvedValue({ currentStock: showroomStock, reserved: 0, availableStock: showroomStock }),
          },
        },
        { provide: StockRouterService, useValue: { isInventoryManagementEnabled: jest.fn().mockResolvedValue(true) } },
        { provide: TrackingCaptureService, useValue: {} },
        { provide: TrackingSettingsService, useValue: {} },
        { provide: CommissionsService, useValue: {} },
        { provide: CustomerAddressService, useValue: {} },
        { provide: SalesChannelService, useValue: {} },
        { provide: MediaResolverService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
      ],
    }).compile();
    service = moduleRef.get(PosOrdersService);
  }

  it('finds a godown holding the product under a DIFFERENT variant', async () => {
    // The exact production shape: showroom has no row for this product, and
    // the godown holds it under variant-b while the cashier is on variant-a.
    await build([row(GODOWN, VARIANT_B, 40)]);
    const res: any = await service.getProductAvailability(PRODUCT, SHOWROOM, VARIANT_A);

    expect(res.network).toHaveLength(1);
    expect(res.network[0].warehouseId).toBe(GODOWN);
    expect(res.network[0].available).toBe(40);
    // The exact variant is not there — transfer would need a different pick,
    // but the LOCATION must no longer be hidden.
    expect(res.network[0].exactVariantAvailable).toBe(0);
  });

  it('reports the exact variant separately when it IS available', async () => {
    await build([row(GODOWN, VARIANT_A, 12), row(GODOWN, VARIANT_B, 8)]);
    const res: any = await service.getProductAvailability(PRODUCT, SHOWROOM, VARIANT_A);

    expect(res.network).toHaveLength(1);
    expect(res.network[0].available).toBe(20);          // whole product at the location
    expect(res.network[0].exactVariantAvailable).toBe(12); // the variant being moved
  });

  it('finds a product-level (variantId NULL) godown row', async () => {
    await build([row(GODOWN, null, 25)]);
    const res: any = await service.getProductAvailability(PRODUCT, SHOWROOM, VARIANT_A);
    expect(res.network).toHaveLength(1);
    expect(res.network[0].available).toBe(25);
  });

  it('still excludes the current showroom', async () => {
    await build([row(SHOWROOM, VARIANT_A, 5)]);
    const res: any = await service.getProductAvailability(PRODUCT, SHOWROOM, VARIANT_A);
    expect(res.network).toHaveLength(0);
  });

  it('clamps a drifted row (reserved >= quantity) to zero, never negative', async () => {
    await build([row(GODOWN, VARIANT_A, 3, 9)]);
    const res: any = await service.getProductAvailability(PRODUCT, SHOWROOM, VARIANT_A);
    // Nothing genuinely available → the location is not offered.
    expect(res.network).toHaveLength(0);
  });

  it('aggregates several variants into one row per warehouse', async () => {
    await build([row(GODOWN, VARIANT_A, 10), row(GODOWN, VARIANT_B, 15)]);
    const res: any = await service.getProductAvailability(PRODUCT, SHOWROOM, VARIANT_A);
    expect(res.network).toHaveLength(1);
    expect(res.network[0].stock).toBe(25);
    expect(res.network[0].reserved).toBe(0);
  });

  it('works for a simple product (no variantId) by product alone', async () => {
    await build([row(GODOWN, null, 7)]);
    const res: any = await service.getProductAvailability(PRODUCT, SHOWROOM);
    expect(res.network).toHaveLength(1);
    expect(res.network[0].available).toBe(7);
    expect(res.network[0].exactVariantAvailable).toBe(7);
  });
});
