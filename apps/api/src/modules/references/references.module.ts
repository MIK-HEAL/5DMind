import { Module } from "@nestjs/common";
import { ReferencesController } from "./references.controller.js";

@Module({ controllers: [ReferencesController] })
export class ReferencesModule {}
