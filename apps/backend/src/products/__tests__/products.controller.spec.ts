import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ProductsController } from '../products.controller';

describe('ProductsController', () => {
  const adminMethods = [
    'bulkRemove',
    'bulkUpdate',
    'create',
    'update',
    'remove',
    'generateVariants',
    'updateVariant',
  ];

  const publicMethods = ['findAll', 'findBySlug', 'findOne'];

  describe('admin methods', () => {
    it.each(adminMethods)(
      'adds RequiresFeature(admin_products) on %s',
      (method) => {
        const meta = Reflect.getMetadata(
          REQUIRES_FEATURE_KEY,
          ProductsController.prototype[method],
        );
        expect(meta).toBe('admin_products');
      },
    );
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        ProductsController.prototype[method],
      );
      expect(meta).toBeUndefined();
    });
  });
});

/**
 * PLP scale round — list routing. Price sorts without an explicit page
 * number are scroll traffic and must ride the (effectivePrice, id)
 * keyset cursor; an explicit page keeps the offset path (admin lists);
 * non-price sorts keep their legacy routing byte-for-byte (including
 * the cursor-as-page-number reinterpretation).
 */
describe('ProductsController.findAll routing (PLP scale round)', () => {
  const svc: any = {
    findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    findAllCursor: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    resolveCategorySlug: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new ProductsController(svc);

  // Positional mirror of the controller signature:
  // (user, page, perPage, search, type, categoryId, category, tagSlug,
  //  brandSlug, minPrice, maxPrice, isActive, isFeatured, ids, sort,
  //  order, cursor, hasStock, status, fields)
  const call = (over: Record<string, any> = {}) => {
    const a: Record<string, any> = {
      user: null,
      page: undefined,
      perPage: '24',
      search: undefined,
      type: undefined,
      categoryId: undefined,
      category: undefined,
      tagSlug: undefined,
      brandSlug: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      isActive: 'true',
      isFeatured: undefined,
      ids: undefined,
      sort: undefined,
      order: undefined,
      cursor: undefined,
      hasStock: undefined,
      status: undefined,
      fields: 'card',
      ...over,
    };
    return controller.findAll(
      a.user, a.page, a.perPage, a.search, a.type, a.categoryId,
      a.category, a.tagSlug, a.brandSlug, a.minPrice, a.maxPrice,
      a.isActive, a.isFeatured, a.ids, a.sort, a.order, a.cursor,
      a.hasStock, a.status, a.fields,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    svc.findAll.mockResolvedValue({ data: [], meta: {} });
    svc.findAllCursor.mockResolvedValue({ data: [], meta: {} });
  });

  it('routes a first-page price sort to the keyset cursor path', async () => {
    await call({ sort: 'basePrice', order: 'asc' });
    expect(svc.findAllCursor).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'basePrice', order: 'asc' }),
      expect.anything(),
    );
    expect(svc.findAll).not.toHaveBeenCalled();
  });

  it('passes a price-sort cursor through verbatim (never a page number)', async () => {
    await call({ sort: 'price', order: 'desc', cursor: 'NDUwLjUwfHAtOQ' });
    expect(svc.findAllCursor).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'price', cursor: 'NDUwLjUwfHAtOQ' }),
      expect.anything(),
    );
    expect(svc.findAll).not.toHaveBeenCalled();
  });

  it('keeps an explicit page on the offset path for admin price lists', async () => {
    await call({ sort: 'basePrice', order: 'desc', page: '2' });
    expect(svc.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, sort: 'basePrice', order: 'desc' }),
      expect.anything(),
    );
    expect(svc.findAllCursor).not.toHaveBeenCalled();
  });

  it('preserves the legacy cursor-as-page routing for non-price sorts', async () => {
    await call({ sort: 'popularity', order: 'desc', cursor: '3' });
    expect(svc.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, sort: 'popularity' }),
      expect.anything(),
    );
    expect(svc.findAllCursor).not.toHaveBeenCalled();
  });

  it('keeps the no-sort cursor path on findAllCursor', async () => {
    await call({ cursor: 'MjAyNS0wMS0wMlQwMDowMDowMC4wMDBafHAtMg' });
    expect(svc.findAllCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: 'MjAyNS0wMS0wMlQwMDowMDowMC4wMDBafHAtMg',
      }),
      expect.anything(),
    );
    expect(svc.findAll).not.toHaveBeenCalled();
  });
});
