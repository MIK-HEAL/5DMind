import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Inject, Param, Patch, Post, Sse } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Observable } from "rxjs";
import { z } from "zod";
import { WorkspaceStore } from "../../infrastructure/workspace.store.js";
import { ApiIdempotencyKey, IdempotencyKey } from "../../shared/http/idempotency-key.decorator.js";
import { IdempotencyKeyPipe } from "../../shared/http/idempotency-key.pipe.js";
import { ZodValidationPipe } from "../../shared/validation/zod-validation.pipe.js";

const turnSchema = z.object({
  content: z.string().trim().min(1).max(200_000),
  clientMessageId: z.string().min(1).max(200),
  parentNodeId: z.string().min(1).max(200).optional(),
  inquiryRootId: z.string().min(1).max(200).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  relation: z.enum(["main", "branch", "focused-inquiry"]).optional(),
  focusSelection: z.object({
    sourceNodeId: z.string().min(1).max(200),
    text: z.string().trim().min(1).max(1_200),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().nonnegative().optional(),
    contentHash: z.string().trim().min(1).max(64),
  }).optional(),
});
const forkSchema = z.object({
  name: z.string().trim().max(200).optional(),
  contextMode: z.enum(["all", "until-node", "selected-only"]),
});
const compareSchema = z.object({ timelineIds: z.array(z.string().min(1)).min(2).max(8) });
const mergeSchema = z.object({ sourceIds: z.array(z.string().min(1)).min(1).max(8) });
const messageSchema = z.object({ content: z.string().trim().min(1).max(200_000) });

@ApiTags("timelines")
@Controller()
export class TimelinesController {
  constructor(@Inject(WorkspaceStore) private readonly store: WorkspaceStore) {}

  @Get("timelines/:timelineId/context")
  @ApiOperation({ summary: "获取服务端权威上下文" })
  context(@Param("timelineId") timelineId: string) {
    return this.store.getContext(timelineId);
  }

  @Post("timelines/:timelineId/turns")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiIdempotencyKey()
  @ApiOperation({ summary: "创建一轮对话并返回 SSE 地址" })
  turn(
    @Param("timelineId") timelineId: string,
    @Body(new ZodValidationPipe(turnSchema)) body: z.infer<typeof turnSchema>,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.store.createTurn(timelineId, body, idempotencyKey);
  }

  @Post("turns/:turnId/cancel")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "取消一轮对话生成" })
  cancel(@Param("turnId") turnId: string) {
    return this.store.cancelTurn(turnId);
  }

  @Post("messages/:messageId/forks")
  @ApiIdempotencyKey()
  @ApiOperation({ summary: "从历史节点创建分支" })
  fork(
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(forkSchema)) body: z.infer<typeof forkSchema>,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.store.forkFromMessage(messageId, body, idempotencyKey);
  }

  @Patch("messages/:messageId")
  @ApiIdempotencyKey()
  @ApiOperation({ summary: "编辑消息内容" })
  updateMessage(
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(messageSchema)) body: z.infer<typeof messageSchema>,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.store.updateMessage(messageId, body.content, idempotencyKey);
  }

  @Delete("messages/:messageId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiIdempotencyKey()
  @ApiOperation({ summary: "删除消息及其后续子消息" })
  deleteMessage(
    @Param("messageId") messageId: string,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.store.deleteMessage(messageId, idempotencyKey);
  }

  @Post("timeline-comparisons")
  @ApiOperation({ summary: "比较多条时间线" })
  compare(@Body(new ZodValidationPipe(compareSchema)) body: z.infer<typeof compareSchema>) {
    return this.store.compareTimelines(body.timelineIds);
  }

  @Post("timelines/:targetId/merge-summaries")
  @ApiIdempotencyKey()
  @ApiOperation({ summary: "将来源分支摘要写入目标线" })
  merge(
    @Param("targetId") targetId: string,
    @Body(new ZodValidationPipe(mergeSchema)) body: z.infer<typeof mergeSchema>,
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.store.mergeSummary(body.sourceIds, targetId, idempotencyKey);
  }

  @Get("turns/:turnId/events")
  @Sse()
  @ApiOperation({ summary: "读取模型流式事件" })
  events(@Param("turnId") turnId: string, @Headers("last-event-id") lastEventId?: string) {
    const parsedLastEventId = Number(lastEventId);
    const afterId = Number.isSafeInteger(parsedLastEventId) && parsedLastEventId >= 0 ? parsedLastEventId : 0;
    return new Observable<{ id: string; type: string; data: Record<string, unknown> }>((subscriber) => {
      void (async () => {
        try {
          for await (const event of this.store.readTurnEvents(turnId, afterId)) {
            subscriber.next({ id: String(event.id), type: event.event, data: event.data });
          }
          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      })();
    });
  }
}
