import { Body, Controller, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  createAppFastifyAdapter,
  MAX_REQUEST_BODY_BYTES,
} from "../src/shared/http/server-options.js";

@Controller()
class EchoController {
  @Post("echo")
  echo(@Body() body: { content: string }) {
    return { received: body.content.length };
  }
}

type InjectOptions = { method: string; url: string; payload?: unknown };
type InjectableApp = INestApplication & {
  inject: (options: InjectOptions) => Promise<{ statusCode: number; json: () => unknown }>;
};

describe("request body limit", () => {
  it("wires the adapter with the attachment-aware body limit", async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [EchoController] }).compile();
    const app = moduleRef.createNestApplication(createAppFastifyAdapter());
    try {
      await app.init();
      const instance = app.getHttpAdapter().getInstance() as { initialConfig?: { bodyLimit?: number } };
      expect(instance.initialConfig?.bodyLimit).toBe(MAX_REQUEST_BODY_BYTES);
    } finally {
      await app.close();
    }
  });

  it("accepts a JSON payload larger than the Fastify default of 1 MB", async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [EchoController] }).compile();
    const app = moduleRef.createNestApplication(createAppFastifyAdapter()) as InjectableApp;
    try {
      await app.init();
      // 2 MB exceeds the previous implicit limit and reproduces the size of an
      // image attachment that used to fail with a generic request error.
      const largeContent = "x".repeat(2 * 1024 * 1024);
      const response = await app.inject({
        method: "POST",
        url: "/echo",
        payload: { content: largeContent },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ received: largeContent.length });
    } finally {
      await app.close();
    }
  });
});
