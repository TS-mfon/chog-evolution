import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {} from "@fastify/rate-limit";
import type { Db } from "mongodb";
import { ApiError } from "./config.js";

export const MAX_REQUEST_BYTES = 65_536;
const GLOBAL_MAX = 120;
const GLOBAL_WINDOW_MS = 60_000;
const MAX_WINDOW_MS = 7 * 24 * 60 * 60_000;
const MAX_LOCAL_BUCKETS = 10_000;
const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,127}$/;

type RouteLimit = Exclude<
  FastifyRequest["routeOptions"]["config"]["rateLimit"],
  false | undefined
>;
type Bucket = { current: number; expires: number };
type Counter = { current: number; ttl: number };

function windowMs(value: unknown): number {
  let result = value;
  if (typeof value === "string") {
    const match =
      /^(\d+(?:\.\d+)?)\s*(ms|milliseconds?|msecs?|s|seconds?|secs?|m|minutes?|mins?|h|hours?|hrs?|d|days?)?$/i.exec(
        value.trim(),
      );
    if (!match) throw new Error("rate_limit_configuration_invalid");
    const unit = match[2]?.toLowerCase() ?? "ms";
    const multiplier = /^(ms|millisecond|msec)/.test(unit)
      ? 1
      : /^(s|sec)/.test(unit)
        ? 1_000
        : /^(m|min)/.test(unit)
          ? 60_000
          : /^(h|hr)/.test(unit)
            ? 3_600_000
            : 86_400_000;
    result = Number(match[1]) * multiplier;
  }
  if (
    typeof result !== "number" ||
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result > MAX_WINDOW_MS
  )
    throw new Error("rate_limit_configuration_invalid");
  return result;
}

function maximum(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("rate_limit_configuration_invalid");
  return value;
}

function validateConfig(config: RouteLimit): void {
  // These are the route settings supported by this shared fixed-window store.
  // Reject other plugin policies at startup instead of silently weakening them.
  const supported = new Set([
    "max",
    "timeWindow",
    "keyGenerator",
    "allowList",
    "whitelist",
    "groupId",
    "hook",
  ]);
  if (
    Object.keys(config).some((key) => !supported.has(key)) ||
    (config.hook !== undefined && config.hook !== "onRequest")
  )
    throw new Error("rate_limit_configuration_unsupported");
  if (typeof config.max !== "function") maximum(config.max ?? GLOBAL_MAX);
  if (typeof config.timeWindow !== "function")
    windowMs(config.timeWindow ?? GLOBAL_WINDOW_MS);
  if (
    config.keyGenerator !== undefined &&
    typeof config.keyGenerator !== "function"
  )
    throw new Error("rate_limit_configuration_invalid");
  const allowList = config.allowList ?? config.whitelist;
  if (
    allowList !== undefined &&
    typeof allowList !== "function" &&
    (!Array.isArray(allowList) ||
      !allowList.every((item) => typeof item === "string"))
  )
    throw new Error("rate_limit_configuration_invalid");
  if (
    config.groupId !== undefined &&
    (typeof config.groupId !== "string" ||
      !config.groupId ||
      config.groupId.length > 200)
  )
    throw new Error("rate_limit_configuration_invalid");
}

async function increment(
  db: Db,
  id: string,
  expires: number,
): Promise<Counter> {
  const collection = db.collection<{
    _id: string;
    current: number;
    expires_at: Date;
    created_at: Date;
  }>("rate_buckets");
  const update = {
    $inc: { current: 1 },
    $setOnInsert: { expires_at: new Date(expires), created_at: new Date() },
  };
  let row;
  try {
    row = await collection.findOneAndUpdate({ _id: id }, update, {
      upsert: true,
      returnDocument: "after",
      includeResultMetadata: false,
      maxTimeMS: 1_000,
      timeoutMS: 1_500,
    });
  } catch (error) {
    // Two cold instances may race to insert the same unique bucket. A duplicate
    // insert has not incremented anything; retry against the winning document.
    if ((error as { code?: unknown } | null)?.code !== 11000) throw error;
    row = await collection.findOneAndUpdate(
      { _id: id },
      { $inc: { current: 1 } },
      {
        returnDocument: "after",
        includeResultMetadata: false,
        maxTimeMS: 1_000,
        timeoutMS: 1_500,
      },
    );
  }
  if (!row || !Number.isSafeInteger(row.current) || row.current < 1)
    throw new Error("rate_store_unavailable");
  return { current: row.current, ttl: Math.max(1, expires - Date.now()) };
}

function rateHeaders(reply: FastifyReply, count: Counter, max: number): void {
  const seconds = Math.max(1, Math.ceil(count.ttl / 1_000));
  reply
    .header("x-ratelimit-limit", max)
    .header("x-ratelimit-remaining", Math.max(0, max - count.current))
    .header("x-ratelimit-reset", seconds);
  if (count.current > max) {
    reply.header("retry-after", seconds);
    throw new ApiError("rate_limit_exceeded", 429);
  }
}

function errorCode(value: unknown, status: number): string {
  if (typeof value === "string" && ERROR_CODE.test(value)) return value;
  if (status >= 500) return "service_unavailable";
  switch (status) {
    case 401:
      return "authentication_required";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 405:
      return "method_not_allowed";
    case 408:
      return "request_timeout";
    case 413:
      return "request_too_large";
    case 415:
      return "unsupported_media_type";
    case 429:
      return "rate_limit_exceeded";
    default:
      return "invalid_request";
  }
}

function envelope(code: string, status: number, requestId: string) {
  return {
    error: code,
    message: code.replace(/_/g, " "),
    requestId,
    retryable: status >= 500 || [202, 408, 425, 429].includes(status),
  };
}

export function installRuntimeControls(
  app: FastifyInstance,
  options: { database?: Db; bodyLimit?: number } = {},
): void {
  const limit = options.bodyLimit ?? MAX_REQUEST_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REQUEST_BYTES)
    throw new Error("body_limit_configuration_invalid");
  const local = new Map<string, Bucket>();
  async function count(
    scope: string,
    key: string,
    duration: number,
  ): Promise<Counter> {
    const now = Date.now();
    const start = Math.floor(now / duration) * duration;
    // No IPs, cookies, tokens, wallet identities or concrete URLs are persisted.
    const id = createHash("sha256")
      .update(JSON.stringify([scope, key, duration, start]))
      .digest("hex");
    if (options.database) {
      try {
        return await increment(options.database, id, start + duration);
      } catch {
        throw new ApiError("rate_limit_store_unavailable", 503);
      }
    }
    let row = local.get(id);
    if (!row) {
      if (local.size >= MAX_LOCAL_BUCKETS) {
        for (const [storedId, stored] of local)
          if (stored.expires <= now) local.delete(storedId);
        if (local.size >= MAX_LOCAL_BUCKETS)
          throw new ApiError("rate_limit_store_unavailable", 503);
      }
      row = { current: 0, expires: start + duration };
      local.set(id, row);
    }
    row.current++;
    return { current: row.current, ttl: Math.max(1, row.expires - now) };
  }

  app.addHook("onRoute", (route) => {
    const config = route.config?.rateLimit;
    if (config !== undefined && config !== false) {
      if (!config || typeof config !== "object")
        throw new Error("rate_limit_configuration_invalid");
      validateConfig(config);
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const suppliedId = request.headers["x-request-id"];
    request.id =
      typeof suppliedId === "string" && REQUEST_ID.test(suppliedId)
        ? suppliedId
        : REQUEST_ID.test(request.id)
          ? request.id
          : randomUUID();
    request.log = request.log.child({ requestId: request.id });
    reply.header("x-request-id", request.id);
    const effectiveLimit = Math.min(limit, request.routeOptions.bodyLimit);
    const length = request.headers["content-length"];
    if (length !== undefined) {
      if (typeof length !== "string" || !/^\d+$/.test(length))
        throw new ApiError("invalid_request", 400);
      if (Number(length) > effectiveLimit) {
        reply.header("connection", "close");
        throw new ApiError("request_too_large", 413);
      }
    }
    const config = request.routeOptions.config.rateLimit;
    if (config === false) return;
    // The global ceiling is shared even across routes with their own quota.
    rateHeaders(
      reply,
      await count("global", request.ip, GLOBAL_WINDOW_MS),
      GLOBAL_MAX,
    );
    if (!config) return;
    const generated = config.keyGenerator
      ? await config.keyGenerator(request)
      : request.ip;
    if (
      (typeof generated !== "string" && typeof generated !== "number") ||
      (typeof generated === "number" && !Number.isFinite(generated))
    )
      throw new Error("rate_limit_configuration_invalid");
    const key = String(generated);
    const allowList = config.allowList ?? config.whitelist;
    if (
      allowList &&
      (typeof allowList === "function"
        ? await allowList(request, key)
        : allowList.includes(key))
    )
      return;
    const max = maximum(
      typeof config.max === "function"
        ? await config.max(request, key)
        : (config.max ?? GLOBAL_MAX),
    );
    const duration = windowMs(
      typeof config.timeWindow === "function"
        ? await config.timeWindow(request, key)
        : (config.timeWindow ?? GLOBAL_WINDOW_MS),
    );
    const method = request.method === "HEAD" ? "GET" : request.method;
    const scope = config.groupId
      ? "group:" + config.groupId
      : "route:" + method + ":" + request.routeOptions.url;
    rateHeaders(reply, await count(scope, key, duration), max);
  });

  app.addHook("preParsing", (request, _reply, payload, done) => {
    const effectiveLimit = Math.min(limit, request.routeOptions.bodyLimit);
    const guard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        guard.receivedEncodedLength += chunk.length;
        callback(
          guard.receivedEncodedLength > effectiveLimit
            ? new ApiError("request_too_large", 413)
            : null,
          guard.receivedEncodedLength > effectiveLimit ? undefined : chunk,
        );
      },
    }) as Transform & { receivedEncodedLength: number };
    guard.receivedEncodedLength = 0;
    const sourceError = (error: Error) => guard.destroy(error);
    payload.on("error", sourceError);
    // The parser may stop consuming after an independent, lower parser limit.
    guard.on("error", () => undefined);
    guard.once("close", () => {
      payload.unpipe(guard);
      payload.removeListener("error", sourceError);
      payload.pause();
    });
    done(null, payload.pipe(guard));
  });

  app.setErrorHandler((error, request, reply) => {
    const candidate =
      error instanceof ApiError
        ? error.status
        : (error as { statusCode?: unknown }).statusCode;
    const status =
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      ((candidate >= 400 && candidate <= 599) ||
        (error instanceof ApiError && candidate === 202))
        ? candidate
        : 500;
    const code = errorCode(
      error instanceof ApiError ? error.code : undefined,
      status,
    );
    if (status >= 500) {
      // A provider error's message, stack and nested request may contain secrets.
      request.log.error(
        { code, statusCode: status, requestId: request.id },
        "Request failed",
      );
    }
    reply.code(status).send(envelope(code, status, request.id));
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    // Leave successful responses byte-for-byte intact, including ERC-721 metadata
    // and evidence documents whose digests must remain stable.
    if (reply.statusCode < 400 && reply.statusCode !== 202) return payload;
    const contentType = String(reply.getHeader("content-type") ?? "");
    if (
      !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|$)/i.test(
        contentType,
      ) ||
      (typeof payload !== "string" && !Buffer.isBuffer(payload))
    )
      return payload;
    let body: unknown;
    try {
      body = JSON.parse(payload.toString());
    } catch {
      body = undefined;
    }
    const code =
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.hasOwn(body, "error")
        ? (body as { error: unknown }).error
        : undefined;
    if (reply.statusCode === 202 && code === undefined) return payload;
    reply.removeHeader("content-length");
    reply.header("cache-control", "no-store");
    return JSON.stringify(
      envelope(errorCode(code, reply.statusCode), reply.statusCode, request.id),
    );
  });
}
