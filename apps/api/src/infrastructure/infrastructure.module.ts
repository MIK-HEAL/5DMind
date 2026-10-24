import { Global, Module } from "@nestjs/common";
import { WorkspaceStore } from "./workspace.store.js";

@Global()
@Module({
  providers: [WorkspaceStore],
  exports: [WorkspaceStore],
})
export class InfrastructureModule {}
