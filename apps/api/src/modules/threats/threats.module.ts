import { Module } from "@nestjs/common";
import { ThreatsController } from "./threats.controller.js";

@Module({ controllers: [ThreatsController] })
export class ThreatsModule {}
