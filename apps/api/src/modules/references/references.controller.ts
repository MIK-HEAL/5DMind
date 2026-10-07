import { Body, Controller, Inject, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { WorkspaceStore } from "../../infrastructure/workspace.store.js";
import { ApiIdempotencyKey, IdempotencyKey } from "../../shared/http/idempotency-key.decorator.js";
import { IdempotencyKeyPipe } from "../../shared/http/idempotency-key.pipe.js";
import { ZodValidationPipe } from "../../shared/validation/zod-validation.pipe.js";

const referenceSchema = z.object({
  sourceNodeId: z.string().min(1).max(200),
  targetTimelineId: z.string().min(1).max(200),
  label: z.string().trim().max(200).optional(),
});

@ApiTags("references")
@Controller("references")
export class ReferencesController {
  constructor(@Inject(WorkspaceStore) private readonly store: WorkspaceStore) {}

  @Post()
  @ApiIdempotencyKey()
  @ApiOperation({ summary: "创建跨盘引用节点和关系" })
  create(
    @Body(new ZodValidationPipe(referenceSchema)) body: z.infer<typeof referenceSchema>,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.store.createReference(body, idempotencyKey);
  }
}
