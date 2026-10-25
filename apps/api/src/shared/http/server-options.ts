import { FastifyAdapter } from "@nestjs/platform-fastify";

// Attachments are sent as JSON. The web client permits up to 24 MB of source
// files, and base64 encoded binary attachments can add roughly one third to
// that size before the request reaches Fastify.
export const MAX_REQUEST_BODY_BYTES = 36 * 1024 * 1024;

/**
 * Builds the Fastify adapter used by the bootstrap entry point. Extracted from
 * main.ts so tests can spin up an identical HTTP surface (body limit included)
 * without triggering the side-effecting bootstrap call.
 */
export function createAppFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    logger: process.env.NODE_ENV !== "test",
    bodyLimit: MAX_REQUEST_BODY_BYTES,
  });
}
