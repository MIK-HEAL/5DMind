import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<{ header: (name: string, value: string) => void }>();
    const request = context.switchToHttp().getRequest<{ id?: string; headers?: Record<string, string | undefined> }>();
    const requestId = request.headers?.["x-request-id"]?.trim() || randomUUID();
    request.id = requestId;
    response.header("x-request-id", requestId);
    return next.handle().pipe(tap(() => undefined));
  }
}
