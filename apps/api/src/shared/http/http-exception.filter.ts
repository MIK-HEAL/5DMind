import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    retryable?: boolean;
  };
  message?: string | string[];
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest & { id?: string }>();
    const reply = http.getResponse<FastifyReply>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = exception instanceof HttpException ? exception.getResponse() : undefined;
    const payload = typeof response === "object" && response !== null ? response as ErrorPayload : {};
    const message = Array.isArray(payload.message) ? payload.message.join("; ") : payload.message;
    const body = {
      error: {
        code: payload.error?.code ?? (status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST"),
        message: payload.error?.message ?? message ?? "请求无法处理",
        requestId: request.id ?? request.headers["x-request-id"] ?? "unknown",
        retryable: payload.error?.retryable ?? (status >= 500 || status === 429 || status === 503),
        details: payload.error?.details,
      },
    };
    if (status >= 500) console.error(exception);
    reply.status(status).send(body);
  }
}
