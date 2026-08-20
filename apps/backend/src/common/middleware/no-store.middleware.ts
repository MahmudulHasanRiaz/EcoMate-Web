import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Marks every API response as non-cacheable.
 *
 * The admin PWA previously cached GET /api/* in the service worker for up to
 * 24h, which surfaced stale product/SKU search results on one device while
 * another stayed fresh. The service worker is now NetworkOnly, and this
 * header is the belt-and-suspenders that keeps home pages, proxies and any
 * other caching layer from ever re-serving live order/inventory/search data.
 */
@Injectable()
export class NoStoreMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate',
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  }
}