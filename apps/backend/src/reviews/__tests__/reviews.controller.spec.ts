import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { ReviewsController } from '../reviews.controller';

describe('ReviewsController', () => {
  const adminMethods = ['findAll', 'approve', 'remove'];

  const publicMethods = ['findByProduct', 'create', 'findLatest'];

  describe('admin methods', () => {
    it.each(adminMethods)(
      'adds RequiresFeature(admin_reviews) on %s',
      (method) => {
        const meta = Reflect.getMetadata(
          REQUIRES_FEATURE_KEY,
          ReviewsController.prototype[method],
        );
        expect(meta).toBe('admin_reviews');
      },
    );
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        ReviewsController.prototype[method],
      );
      expect(meta).toBeUndefined();
    });
  });

  /**
   * The admin reviews screen reads `response.data.data` (paginated envelope).
   * It used to read the body as a bare array, which left the moderation queue
   * permanently empty. Pin the envelope at the HTTP boundary so a future
   * controller change cannot silently regress it again.
   */
  describe('findAll response contract', () => {
    function makeController() {
      const service = {
        findAll: jest.fn().mockResolvedValue({
          data: [{ id: 'rev-1', approved: false }],
          meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
        }),
      };
      return { controller: new ReviewsController(service as any), service };
    }

    it('returns the paginated { data, meta } envelope, never a bare array', async () => {
      const { controller } = makeController();

      const result = await controller.findAll();

      expect(Array.isArray(result)).toBe(false);
      expect(result).toEqual({
        data: [{ id: 'rev-1', approved: false }],
        meta: { total: 1, page: 1, perPage: 100, totalPages: 1 },
      });
    });

    it('parses page/perPage and forwards status + productId to the service', async () => {
      const { controller, service } = makeController();

      await controller.findAll('2', '100', 'pending', 'prod-9');

      expect(service.findAll).toHaveBeenCalledWith({
        page: 2,
        perPage: 100,
        status: 'pending',
        productId: 'prod-9',
      });
    });

    it('leaves pagination undefined so the service defaults apply', async () => {
      const { controller, service } = makeController();

      await controller.findAll();

      expect(service.findAll).toHaveBeenCalledWith({
        page: undefined,
        perPage: undefined,
        status: undefined,
        productId: undefined,
      });
    });
  });
});
