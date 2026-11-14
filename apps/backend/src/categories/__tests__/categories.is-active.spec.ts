import { CategoriesController } from '../categories.controller';
import { CategoriesService } from '../categories.service';

/**
 * GET /categories?isActive=true must actually filter — the storefront
 * sitemap fetches exactly that URL, so an ignored param would list
 * inactive categories publicly. `findAll()` with no filter keeps the
 * admin's unfiltered full-set list.
 */

const ACTIVE = {
  id: 'cat-active',
  name: 'Active',
  slug: 'active',
  isActive: true,
  image: null,
  children: [],
};
const INACTIVE = {
  id: 'cat-inactive',
  name: 'Inactive',
  slug: 'inactive',
  isActive: false,
  image: null,
  children: [],
};

function makeService() {
  // Mock Prisma honours the where clause the service builds, the way the
  // real client does — so the test proves the service passes the filter
  // through instead of ignoring it.
  const prisma = {
    category: {
      findMany: jest.fn(async ({ where }: any) => {
        let rows = [ACTIVE, INACTIVE];
        if (where?.isActive !== undefined) {
          rows = rows.filter((c) => c.isActive === where.isActive);
        }
        return rows.map((c) => ({ ...c }));
      }),
    },
  };
  const store = new Map<string, any>();
  const cache = {
    get: jest.fn(async (key: string) => store.get(key)),
    set: jest.fn(async (key: string, value: any) => {
      store.set(key, value);
    }),
    invalidateByPrefix: jest.fn(async () => undefined),
  };
  const mediaResolver = { resolve: jest.fn(async () => ({})) };
  const svc = new CategoriesService(
    prisma as any,
    {} as any,
    mediaResolver as any,
    cache as any,
  );
  return { svc, prisma, cache };
}

describe('CategoriesService.findAll — isActive filter', () => {
  it('excludes inactive categories when isActive=true', async () => {
    const { svc, prisma } = makeService();
    const rows = await svc.findAll({ isActive: true });
    expect(rows.map((r: any) => r.slug)).toEqual(['active']);
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('returns only inactive categories when isActive=false', async () => {
    const { svc } = makeService();
    const rows = await svc.findAll({ isActive: false });
    expect(rows.map((r: any) => r.slug)).toEqual(['inactive']);
  });

  it('returns everything with no filter (admin full-set list)', async () => {
    const { svc, prisma } = makeService();
    const rows = await svc.findAll();
    expect(rows.map((r: any) => r.slug)).toEqual(['active', 'inactive']);
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('caches filtered and unfiltered lists under different keys', async () => {
    const { svc, prisma, cache } = makeService();
    await svc.findAll({ isActive: true });
    await svc.findAll({ isActive: false });
    await svc.findAll();
    expect(cache.set).toHaveBeenCalledWith(
      'categories:all:isActive:true',
      expect.anything(),
    );
    expect(cache.set).toHaveBeenCalledWith(
      'categories:all:isActive:false',
      expect.anything(),
    );
    expect(cache.set).toHaveBeenCalledWith('categories:all', expect.anything());

    // Second filtered read is served from cache — no second DB hit.
    const callsBefore = prisma.category.findMany.mock.calls.length;
    const rows = await svc.findAll({ isActive: true });
    expect(rows.map((r: any) => r.slug)).toEqual(['active']);
    expect(prisma.category.findMany.mock.calls.length).toBe(callsBefore);
  });
});

describe('CategoriesController.findAll — query parsing', () => {
  function makeController() {
    const svc = { findAll: jest.fn().mockResolvedValue([]) };
    return { ctrl: new CategoriesController(svc as any), svc };
  }

  it('passes { isActive: true } for ?isActive=true', async () => {
    const { ctrl, svc } = makeController();
    await ctrl.findAll('true');
    expect(svc.findAll).toHaveBeenCalledWith({ isActive: true });
  });

  it('passes { isActive: false } for ?isActive=false', async () => {
    const { ctrl, svc } = makeController();
    await ctrl.findAll('false');
    expect(svc.findAll).toHaveBeenCalledWith({ isActive: false });
  });

  it('passes no filter when the param is absent or unrecognised', async () => {
    const { ctrl, svc } = makeController();
    await ctrl.findAll();
    await ctrl.findAll('yes');
    expect(svc.findAll).toHaveBeenCalledWith({});
    expect(svc.findAll).toHaveBeenCalledTimes(2);
  });
});
