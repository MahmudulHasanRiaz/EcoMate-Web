import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { AsyncLocalStorage } from 'async_hooks';

export const correlationIdStorage = new AsyncLocalStorage<string>();

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: FastifyRequest, res: FastifyReply, next: () => void) {
    const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
    correlationIdStorage.run(correlationId, () => {
      res.header('x-correlation-id', correlationId);
      next();
    });
  }
}
