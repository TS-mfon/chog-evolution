import type { HTTPMethods } from "fastify";
import { buildApp } from "@chog/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const app = buildApp();
const ready = app.ready();

async function handle(request: Request): Promise<Response> {
  await ready;
  const source = new URL(request.url);
  const url = `${source.pathname.replace(/^\/api(?=\/|$)/, "") || "/"}${source.search}`;
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const payload =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : Buffer.from(await request.arrayBuffer());
  const result = await app.inject({
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
  return new Response(new Uint8Array(result.rawPayload), {
    status: result.statusCode,
    headers: responseHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
