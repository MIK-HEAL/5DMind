import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { IdempotencyKeyPipe } from "../src/shared/http/idempotency-key.pipe.js";

describe("IdempotencyKeyPipe", () => {
  const pipe = new IdempotencyKeyPipe();

  it("normalizes a provided key", () => {
    expect(pipe.transform("  mutation-1  ")).toBe("mutation-1");
  });

  it("rejects a missing key", () => {
    expect(() => pipe.transform(undefined)).toThrow(BadRequestException);
  });
});
