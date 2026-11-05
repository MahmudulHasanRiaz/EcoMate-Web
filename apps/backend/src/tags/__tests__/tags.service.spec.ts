import { TagsService } from '../tags.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * PLP scale round — the tags facet list (GET /tags/facets): the query
 * itself is the contract. Membership is restricted to tags carried by
 * at least one VISIBLE product (active, not a draft — the same gate
 * the public product reads use), so the storefront filter rail can
 * never offer a tag whose archive would be empty, and tags used only
 * by drafts/inactive products stay out. Shape matches findAll: a bare
 * array of tag rows with _count.products, name-ordered.
 */
describe('TagsService.findFacets (PLP scale round)', () => {
  const findMany = jest.fn();
  const prisma = { tag: { findMany } } as unknown as PrismaService;
  const service = new TagsService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries only tags used by at least one active, non-draft product', async () => {
    findMany.mockResolvedValue([]);
    await service.findFacets();
    expect(findMany).toHaveBeenCalledWith({
      where: {
        products: {
          some: {
            product: { isActive: true, status: { not: 'draft' } },
          },
        },
      },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  });

  it('returns the tag rows untouched (bare array, findAll shape)', async () => {
    const rows = [
      {
        id: 'tag-1',
        name: 'Cotton',
        slug: 'cotton',
        productCount: 3,
        _count: { products: 3 },
      },
      {
        id: 'tag-2',
        name: 'Sale',
        slug: 'sale',
        productCount: 1,
        _count: { products: 1 },
      },
    ];
    findMany.mockResolvedValue(rows);
    const result = await service.findFacets();
    expect(result).toEqual(rows);
  });
});
