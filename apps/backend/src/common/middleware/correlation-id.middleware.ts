import { Injectable, NestMiddleware } from '@nestjs/common';
import { IncomingMessage, ServerResponse } from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import { AsyncLocalStorage } from 'async_hooks';

export const correlationIdStorage = new AsyncLocalStorage<string>();

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const correlationId =
      (req.headers['x-correlation-id'] as string) || uuidv4();
    correlationIdStorage.run(correlationId, () => {
      res.setHeader('x-correlation-id', correlationId);
      next();
    });
  }
}
