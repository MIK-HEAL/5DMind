import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cors from "@fastify/cors";
import { AppModule } from "./app.module.js";
import { RequestIdInterceptor } from "./shared/http/request-id.interceptor.js";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: process.env.NODE_ENV !== "test" }),
  );

  app.setGlobalPrefix("api/v1");
  // Nest's Fastify adapter and the workspace plugin can resolve separate Fastify type trees.
  // The runtime plugin contract is compatible; keep the cast at this integration boundary.
  await app.register(cors as any, {
    origin: process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()) ?? true,
    credentials: true,
  });
  app.useGlobalInterceptors(new RequestIdInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle("5DMind API")
    .setDescription("对话、时间线、分支与风险的模块化单体 API")
    .setVersion("1.0")
    .setOpenAPIVersion("3.1.0")
    .addBearerAuth()
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, swaggerConfig);
  app.getHttpAdapter().getInstance().get("/api/v1/openapi.json", (_request, reply) => {
    void reply.send(openApiDocument);
  });

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen(port, host);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
