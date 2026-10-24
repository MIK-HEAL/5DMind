import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";

@Injectable()
export class IdempotencyKeyPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException({
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "写请求必须提供 Idempotency-Key 请求头",
        },
      });
    }

    const key = value.trim();
    if (key.length > 200) {
      throw new BadRequestException({
        error: {
          code: "IDEMPOTENCY_KEY_INVALID",
          message: "Idempotency-Key 不能超过 200 个字符",
        },
      });
    }

    return key;
  }
}
