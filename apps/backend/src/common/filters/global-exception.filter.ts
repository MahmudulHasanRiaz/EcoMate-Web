import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Internal server error',
          };

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled Exception at ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : exception,
      );
    }

    const payload = typeof message === 'string' ? { message } : (message as object);
    const body = { ...payload, timestamp: new Date().toISOString(), path: request.url };

    try {
      // Try Express-style response
      if (typeof response.status === 'function' && typeof response.json === 'function') {
        response.status(status).json(body);
        return;
      }
    } catch {
      // Fall through to raw send
    }

    // Fallback: Fastify-style or raw response
    try {
      response.statusCode = status;
      response.setHeader?.('Content-Type', 'application/json');
      response.end?.(JSON.stringify(body));
    } catch {
      // Last resort — can't send response
      this.logger.error('Failed to send error response');
    }
  }
}
