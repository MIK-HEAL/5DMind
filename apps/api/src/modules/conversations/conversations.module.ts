import { Module } from "@nestjs/common";
import { ConversationsController } from "./conversations.controller.js";

@Module({ controllers: [ConversationsController] })
export class ConversationsModule {}
