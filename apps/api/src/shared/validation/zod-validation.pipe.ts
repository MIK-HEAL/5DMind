import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import { z, type ZodType } from "zod";

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      error: {
        code: "VALIDATION_ERROR",
        message: "请求参数校验失败",
        retryable: false,
        details: z.treeifyError(result.error),
      },
    });
  }
}
