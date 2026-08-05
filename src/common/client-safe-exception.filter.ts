import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Maps Prisma / unexpected errors to short client-safe JSON.
 * Avoids leaking stack traces or raw driver messages to the app UI.
 */
@Catch()
export class ClientSafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ClientSafeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ??
            exception.message);
      res.status(status).json({
        statusCode: status,
        message,
      });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      this.logger.warn(`Prisma ${exception.code}: ${exception.message}`);
      const mapped = this.mapPrisma(exception);
      res.status(mapped.status).json({
        statusCode: mapped.status,
        message: mapped.message,
      });
      return;
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.warn(`Prisma validation: ${exception.message}`);
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid data sent to the server',
      });
      return;
    }

    // Interactive transaction timeouts often surface as plain Errors.
    const raw =
      exception instanceof Error ? exception.message : String(exception);
    this.logger.error(`Unhandled: ${raw}`);
    const isTimeout =
      /transaction|timed out|timeout|P2028/i.test(raw) ||
      /Unable to start a transaction/i.test(raw);

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: isTimeout
        ? 'The server is busy. Please try again in a moment.'
        : 'Something went wrong. Please try again.',
    });
  }

  private mapPrisma(err: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
  } {
    switch (err.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: 'That record already exists',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Record not found',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Related record is missing or invalid',
        };
      case 'P2028':
        return {
          status: HttpStatus.GATEWAY_TIMEOUT,
          message: 'The server is busy. Please try again in a moment.',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Something went wrong. Please try again.',
        };
    }
  }
}
