import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { OrdersController } from '../orders.controller';

describe('OrdersController', () => {
  const adminMethods = [
    'backfillViewTokens',
    'rotateViewToken',
    'updateOrder',
    'updateStatus',
    'addItem',
    'removeItem',
    'addNote',
    'bulkOrders',
    'bulkStatus',
    'bulkDispatch',
    'bulkAssign',
    'staffList',
  ];

  const publicMethods = [
    'create',
    'findByPhone',
    'findByViewToken',
    'findOne',
    'cancelByCustomer',
  ];

  describe('admin methods', () => {
    it.each(adminMethods)(
      'adds RequiresFeature(admin_orders) on %s',
      (method) => {
        const meta = Reflect.getMetadata(
          REQUIRES_FEATURE_KEY,
          OrdersController.prototype[method],
        );
        expect(meta).toBe('admin_orders');
      },
    );
  });

  describe('public methods', () => {
    it.each(publicMethods)('does not add RequiresFeature on %s', (method) => {
      const meta = Reflect.getMetadata(
        REQUIRES_FEATURE_KEY,
        OrdersController.prototype[method],
      );
      expect(meta).toBeUndefined();
    });
  });
});
