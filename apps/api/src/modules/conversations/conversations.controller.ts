import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { WorkspaceStore } from "../../infrastructure/workspace.store.js";
import { ApiIdempotencyKey, IdempotencyKey } from "../../shared/http/idempotency-key.decorator.js";
import { IdempotencyKeyPipe } from "../../shared/http/idempotency-key.pipe.js";
import { ZodValidationPipe } from "../../shared/validation/zod-validation.pipe.js";

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

@ApiTags("conversations")
@Controller("conversations")
export class ConversationsController {
  constructor(@Inject(WorkspaceStore) private readonly store: WorkspaceStore) {}

  @Get()
  @ApiOperation({ summary: "获取对话导航列表" })
  list() {
    return { conversations: this.store.listConversations() };
  }

  @Post()
  @ApiIdempotencyKey()
  @ApiOperation({ summary: "创建对话及默认主线" })
  create(
    @Body(new ZodValidationPipe(createConversationSchema)) body: z.infer<typeof createConversationSchema>,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.store.createConversation(body.title, idempotencyKey);
  }

  @Get(":conversationId/graph")
  @ApiOperation({ summary: "获取对话时间线图快照" })
  graph(@Param("conversationId") conversationId: string) {
    return this.store.getGraph(conversationId);
  }
}
