import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { ApiHeader } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

export const IdempotencyKey = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  return request.headers["idempotency-key"];
});

export const ApiIdempotencyKey = () => ApiHeader({
  name: "Idempotency-Key",
  description: "客户端为每次写操作生成的唯一键；重试时复用同一个值",
  required: true,
  schema: { type: "string", maxLength: 200 },
});
