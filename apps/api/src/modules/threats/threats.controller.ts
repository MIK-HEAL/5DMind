import { Body, Controller, Inject, Param, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { WorkspaceStore } from "../../infrastructure/workspace.store.js";
import { ApiIdempotencyKey, IdempotencyKey } from "../../shared/http/idempotency-key.decorator.js";
import { IdempotencyKeyPipe } from "../../shared/http/idempotency-key.pipe.js";
import { ZodValidationPipe } from "../../shared/validation/zod-validation.pipe.js";

const createThreatSchema = z.object({
  conversationId: z.string().min(1).max(200),
  nodeId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  detail: z.string().max(20_000).optional(),
  severity: z.enum(["low", "medium", "high"]),
});
const resolveThreatSchema = z.object({
  resolution: z.string().trim().min(1).max(20_000),
  expectedVersion: z.number().int().positive().optional(),
});

@ApiTags("threats")
@Controller("threats")
export class ThreatsController {
  constructor(@Inject(WorkspaceStore) private readonly store: WorkspaceStore) {}

  @Post()
  @ApiIdempotencyKey()
  @ApiOperation({ summary: "创建风险" })
  create(
    @Body(new ZodValidationPipe(createThreatSchema)) body: z.infer<typeof createThreatSchema>,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.store.createThreat(body, idempotencyKey);
  }

  @Patch(":threatId/resolve")
  @ApiIdempotencyKey()
  @ApiOperation({ summary: "解决风险" })
  resolve(
    @Param("threatId") threatId: string,
    @Body(new ZodValidationPipe(resolveThreatSchema)) body: z.infer<typeof resolveThreatSchema>,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.store.resolveThreat(threatId, body.resolution, body.expectedVersion, idempotencyKey);
  }
}
