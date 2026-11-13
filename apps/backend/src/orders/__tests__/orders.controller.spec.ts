import { REQUIRES_FEATURE_KEY } from '@ecomate/feature-flags';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import * as fs from 'fs';
import * as path from 'path';
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

  describe('trashedOnly contract (dashboard-counts round, Scope 3)', () => {
    const controller = new OrdersController(
      { findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }) } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    it('passes includeTrashed + trashedOnly through to the service', () => {
      (controller as any).svc.findAll.mockClear();

      controller.findAll(
        undefined, // page
        undefined, // perPage
        undefined, // search
        undefined, // statusId
        undefined, // paymentStatus
        undefined, // courier
        undefined, // assignedToId
        undefined, // dateFrom
        undefined, // dateTo
        undefined, // sort
        undefined, // order
        'true', // includeTrashed
        'true', // trashedOnly
        undefined, // kind
        undefined, // type
      );

      expect((controller as any).svc.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          includeTrashed: true,
          trashedOnly: true,
        }),
      );
    });

    it('defaults trashedOnly to false when the param is absent', () => {
      (controller as any).svc.findAll.mockClear();

      controller.findAll();

      expect((controller as any).svc.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          includeTrashed: false,
          trashedOnly: false,
        }),
      );
    });
  });

  describe('no permanent-delete surface for orders (owner rule 2026-11-13)', () => {
    /** Every (handler, HTTP method, path) the controller registers. */
    function registeredRoutes(): Array<{
      handler: string;
      httpMethod: number;
      path: string;
    }> {
      const routes: Array<{
        handler: string;
        httpMethod: number;
        path: string;
      }> = [];
      for (const name of Object.getOwnPropertyNames(
        OrdersController.prototype,
      )) {
        const fn = (OrdersController.prototype as any)[name];
        if (typeof fn !== 'function') continue;
        const httpMethod = Reflect.getMetadata(METHOD_METADATA, fn);
        if (httpMethod === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, fn) ?? '';
        routes.push({ handler: name, httpMethod, path: String(path) });
      }
      return routes;
    }

    it('registers no DELETE route for the order itself', () => {
      const deletes = registeredRoutes().filter(
        (r) => r.httpMethod === RequestMethod.DELETE,
      );
      // Sub-resource deletes are fine (order item, edit lock) — the ORDER
      // itself must never be hard-deletable: trash + restore only.
      for (const d of deletes) {
        expect(d.path).not.toBe(':id');
        expect(d.path).not.toBe('/');
        expect(d.path).not.toBe('');
      }
      expect(deletes.map((d) => d.path).sort()).toEqual([
        ':id/items/:itemId',
        ':id/lock',
      ]);
    });

    it('the service has no hard-delete call for orders (trash/restore only)', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '..', 'orders.service.ts'),
        'utf8',
      );
      expect(src).not.toMatch(/\.order\.delete\s*\(/);
      expect(src).not.toMatch(/\.order\.deleteMany\s*\(/);
      // The soft-delete surface itself must still exist.
      expect(src).toMatch(/async trash\(/);
      expect(src).toMatch(/async restore\(/);
    });
  });
});
