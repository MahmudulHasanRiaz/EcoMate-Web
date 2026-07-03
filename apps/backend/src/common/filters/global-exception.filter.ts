import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FastifyRequest, FastifyReply } from 'fastify';
import { ServerResponse } from 'node:http';

const PRISMA_USER_MESSAGES: Record<string, string> = {
  P2000: 'The provided value is too long for the column.',
  P2002: 'A record with this value already exists.',
  P2003: 'Referenced record not found.',
  P2025: 'Record not found.',
  P1001: 'Database connection failed. Please try again.',
  P1002: 'Database server timed out. Please try again.',
  P1017: 'Database server disconnected. Please try again.',
  P2011: 'Upload data is incomplete. One or more required fields are missing.',
  P2014: 'A required related record is missing.',
  P2016: 'Query interpretation error. Please try again.',
  P2021: 'This feature is temporarily unavailable. Database setup in progress.',
  P2023: 'Database schema update in progress. Please try again shortly.',
};

function parsePrismaError(exception: Prisma.PrismaClientKnownRequestError): {
  status: number;
  message: string;
} {
  const code = exception.code;
  const userMsg =
    PRISMA_USER_MESSAGES[code] ||
    'A database error occurred. Please try again.';

  let detail = '';
  if (code === 'P2002' && exception.meta) {
    const target = Array.isArray((exception.meta as any).target)
      ? (exception.meta as any).target.join(', ')
      : '';
    detail = target ? ` (${target})` : '';
  }
  if (code === 'P2003' && exception.meta) {
    detail = (exception.meta as any)?.field_name
      ? ` (${(exception.meta as any).field_name})`
      : '';
  }

  const statusMap: Record<string, number> = {
    P2000: HttpStatus.BAD_REQUEST,
    P2002: HttpStatus.CONFLICT,
    P2003: HttpStatus.BAD_REQUEST,
    P2011: HttpStatus.BAD_REQUEST,
    P2014: HttpStatus.BAD_REQUEST,
    P2016: HttpStatus.BAD_REQUEST,
    P2025: HttpStatus.NOT_FOUND,
    P1001: HttpStatus.SERVICE_UNAVAILABLE,
    P1002: HttpStatus.SERVICE_UNAVAILABLE,
    P1017: HttpStatus.SERVICE_UNAVAILABLE,
    P2021: HttpStatus.SERVICE_UNAVAILABLE,
    P2023: HttpStatus.SERVICE_UNAVAILABLE,
  };

  return {
    status: statusMap[code] || HttpStatus.INTERNAL_SERVER_ERROR,
    message: userMsg + detail,
  };
}

function sendResponse(
  response: FastifyReply | ServerResponse,
  status: number,
  body: Record<string, unknown>,
) {
  if ('code' in response) {
    (response as FastifyReply).code(status).send(body);
  } else {
    const res = response as ServerResponse;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply | ServerResponse>();
    const request = ctx.getRequest<FastifyRequest>();

    // Handle Prisma errors with user-friendly messages
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const { status, message } = parsePrismaError(exception);
      const body = {
        message,
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
      };

      this.logger.warn(
        `Prisma error ${exception.code} at ${request.method} ${request.url}: ${exception.message}`,
      );

      sendResponse(response, status, body);
      return;
    }

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

    const payload = typeof message === 'string' ? { message } : message;
    const body = {
      ...payload,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    sendResponse(response, status, body);
  }
}
