import { Module } from "@nestjs/common";
import { TimelinesController } from "./timelines.controller.js";

@Module({ controllers: [TimelinesController] })
export class TimelinesModule {}
