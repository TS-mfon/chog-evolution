import type { HTTPMethods } from "fastify";
import { buildApp } from "@chog/api";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_BODY = 65536;

let appPromise: Promise<ReturnType<typeof buildApp>> | undefined;

function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const app = buildApp();
      await app.ready();
      return app;
    })().catch((error: unknown) => {
      appPromise = undefined;
      throw error;
    });
  }
  return appPromise;
}

async function handle(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const failure = (error: string, status: number) =>
    Response.json(
      {
        error,
        message: error.replace(/_/g, " "),
        requestId,
        retryable: status >= 500 || status === 429,
      },
      { status, headers: { "x-request-id": requestId } },
    );
  try {
    if (Number(request.headers.get("content-length")) > MAX_BODY)
      return failure("request_too_large", 413);
    const app = await getApp();
    const source = new URL(request.url);
    const url = `${source.pathname.replace(/^\/api(?=\/|$)/, "") || "/"}${source.search}`;
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    headers["x-request-id"] = requestId;
    let payload: Buffer | undefined;
    if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > MAX_BODY) {
            await reader.cancel();
            return failure("request_too_large", 413);
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      payload = Buffer.concat(chunks);
    }
    const platformIp =
      process.env.VERCEL === "1"
        ? request.headers.get("x-vercel-forwarded-for")?.trim()
        : undefined;
    const result = await app.inject({
      remoteAddress: platformIp && isIP(platformIp) ? platformIp : "127.0.0.1",
      method: request.method as HTTPMethods,
      url,
      headers,
      ...(payload ? { payload } : {}),
    });
    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(result.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) responseHeaders.append(key, String(item));
      } else {
        responseHeaders.set(key, String(value));
      }
    }
    return new Response(
      request.method === "HEAD" ||
        result.statusCode === 204 ||
        result.statusCode === 304
        ? null
        : new Uint8Array(result.rawPayload),
      {
        status: result.statusCode,
        headers: responseHeaders,
      },
    );
  } catch {
    console.error("CHOG API could not complete this request.");
    return failure("service_unavailable", 503);
  }
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
