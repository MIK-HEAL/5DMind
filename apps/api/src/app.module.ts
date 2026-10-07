import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConversationsModule } from "./modules/conversations/conversations.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { ReferencesModule } from "./modules/references/references.module.js";
import { ThreatsModule } from "./modules/threats/threats.module.js";
import { TimelinesModule } from "./modules/timelines/timelines.module.js";
import { InfrastructureModule } from "./infrastructure/infrastructure.module.js";
import { HttpExceptionFilter } from "./shared/http/http-exception.filter.js";

@Module({
  imports: [
    InfrastructureModule,
    HealthModule,
    ConversationsModule,
    TimelinesModule,
    ReferencesModule,
    ThreatsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
