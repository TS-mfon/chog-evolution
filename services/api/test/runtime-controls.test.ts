import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { Readable, Writable } from "node:stream";
import Fastify from "fastify";
import type { Db } from "mongodb";
import { ApiError } from "../src/config.js";
import {
  installRuntimeControls,
  MAX_REQUEST_BYTES,
} from "../src/runtime-controls.js";
import { parsePage, pageQuery, paginateRows } from "../src/pagination.js";
import { MemoryDb } from "./memory-db.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function checkEnvelope(
  response: {
    statusCode: number;
    headers: Record<string, unknown>;
    json(): unknown;
  },
  error: string,
  statusCode: number,
  retryable: boolean,
) {
  const body = response.json() as Record<string, unknown>;
  assert.equal(response.statusCode, statusCode);
  assert.deepEqual(Object.keys(body).sort(), [
    "error",
    "message",
    "requestId",
    "retryable",
  ]);
  assert.equal(body.error, error);
  assert.equal(body.message, error.replace(/_/g, " "));
  assert.equal(body.retryable, retryable);
  assert.equal(body.requestId, response.headers["x-request-id"]);
  assert.match(String(body.requestId), UUID);
}

test("server-generated request IDs survive installation and bind progress and error logs", async () => {
  const serverId = "c827e589-bc27-4e73-b291-041a394c0ca4";
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      logs.push(String(chunk));
      done();
    },
  });
  const app = Fastify({ genReqId: () => serverId, logger: { stream } });
  installRuntimeControls(app);
  app.get("/error", async (request) => {
    request.log.info("Reading source");
    throw new Error("SECRET_PROVIDER_URL");
  });
  try {
    const response = await app.inject("/error");
    checkEnvelope(response, "service_unavailable", 500, true);
    assert.equal(response.headers["x-request-id"], serverId);
    const entries = logs
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const relevant = entries.filter((entry) =>
      ["Reading source", "Request failed"].includes(entry.msg),
    );
    assert.equal(relevant.length, 2);
    assert.ok(entries.every((entry) => entry.reqId === serverId));
    assert.ok(relevant.every((entry) => entry.requestId === serverId));
    assert.doesNotMatch(logs.join(""), /SECRET_PROVIDER_URL/);
  } finally {
    await app.close();
  }
});

test("error envelopes correlate request IDs and redact exception, validation and explicit error details", async () => {
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      logs.push(String(chunk));
      done();
    },
  });
  const app = Fastify({ logger: { stream } });
  installRuntimeControls(app);
  const secret =
    "https://api.example/SECRET_TOKEN?password=PRIVATE_DATABASE_PASSWORD";
  app.get("/error", async () => {
    throw Object.assign(new Error(secret), {
      config: { token: secret },
      request: { url: secret },
    });
  });
  app.get("/known", async (_request, reply) =>
    reply.code(422).send({
      error: "evidence_rejected",
      message: secret,
      details: { url: secret },
      requestId: "forged",
      stack: secret,
    }),
  );
  app.get("/bad-code", async () => {
    throw new ApiError(secret, 503);
  });
  app.get("/bad-status", async () => {
    throw Object.assign(new Error(secret), { statusCode: 999 });
  });
  app.get("/plain-failure", async (_request, reply) =>
    reply.code(503).send({ internal: secret }),
  );
  app.get("/pending", async (_request, reply) =>
    reply.code(202).send({ error: "mint_receipt_pending" }),
  );
  app.post(
    "/schema",
    {
      schema: {
        body: {
          type: "object",
          properties: { count: { type: "integer" } },
          required: ["count"],
        },
      },
    },
    async (request) => request.body,
  );
  try {
    const supplied = "c827e589-bc27-4e73-b291-041a394c0ca4";
    const response = await app.inject({
      url: "/error",
      headers: { "x-request-id": supplied },
    });
    checkEnvelope(response, "service_unavailable", 500, true);
    assert.equal(response.headers["x-request-id"], supplied);
    assert.doesNotMatch(response.body, /SECRET|PRIVATE|api\.example/);
    const invalidId = await app.inject({
      url: "/error",
      headers: { "x-request-id": "Bearer_PRIVATE_TOKEN" },
    });
    checkEnvelope(invalidId, "service_unavailable", 500, true);
    assert.notEqual(
      invalidId.headers["x-request-id"],
      response.headers["x-request-id"],
    );
    for (const [url, error, status, retryable] of [
      ["/known", "evidence_rejected", 422, false],
      ["/bad-code", "service_unavailable", 503, true],
      ["/bad-status", "service_unavailable", 500, true],
      ["/plain-failure", "service_unavailable", 503, true],
      ["/pending", "mint_receipt_pending", 202, true],
      ["/not-a-real-route", "not_found", 404, false],
    ] as const)
      checkEnvelope(await app.inject(url), error, status, retryable);
    const invalid = await app.inject({
      method: "POST",
      url: "/schema",
      payload: { count: secret },
    });
    checkEnvelope(invalid, "invalid_request", 400, false);
    assert.doesNotMatch(
      logs.join(""),
      /SECRET_TOKEN|PRIVATE_DATABASE_PASSWORD|Bearer_PRIVATE_TOKEN/,
    );
  } finally {
    await app.close();
  }
});

test("successful JSON, evidence documents, metadata, binary streams and accepted jobs keep their exact payloads", async () => {
  const app = Fastify();
  installRuntimeControls(app);
  const serialized =
    '{ "name": "Chog", "error": "an ordinary metadata field", "attributes": [] }\n';
  const bytes = Buffer.from([0, 255, 4, 13, 10, 200]);
  app.get("/ok", async () => ({
    items: [{ id: "a" }],
    nextCursor: null,
    error: "domain_value",
  }));
  app.get("/v1/metadata/demo/1", async (_request, reply) =>
    reply.type("application/json").send(serialized),
  );
  app.get("/v1/evidence/document", async (_request, reply) =>
    reply.type("application/json").send(Buffer.from(serialized)),
  );
  app.get("/image", async (_request, reply) =>
    reply.type("image/png").send(bytes),
  );
  app.get("/stream", async (_request, reply) =>
    reply.type("application/octet-stream").send(Readable.from([bytes])),
  );
  app.get("/accepted", async (_request, reply) =>
    reply.code(202).send({ item: { status: "pending" } }),
  );
  app.get("/array", async () => [1, 2]);
  try {
    const good = await app.inject("/ok");
    assert.deepEqual(good.json(), {
      items: [{ id: "a" }],
      nextCursor: null,
      error: "domain_value",
    });
    assert.match(String(good.headers["x-request-id"]), UUID);
    for (const url of ["/v1/metadata/demo/1", "/v1/evidence/document"]) {
      const response = await app.inject(url);
      assert.equal(response.body, serialized);
      assert.equal(
        Number(response.headers["content-length"]),
        Buffer.byteLength(serialized),
      );
    }
    for (const url of ["/image", "/stream"])
      assert.deepEqual((await app.inject(url)).rawPayload, bytes);
    assert.deepEqual((await app.inject("/accepted")).json(), {
      item: { status: "pending" },
    });
    assert.deepEqual((await app.inject("/array")).json(), [1, 2]);
    const head = await app.inject({
      method: "HEAD",
      url: "/v1/metadata/demo/1",
    });
    assert.equal(head.body, "");
    assert.equal(
      Number(head.headers["content-length"]),
      Buffer.byteLength(serialized),
    );
  } finally {
    await app.close();
  }
});

test("advertised byte limits enforce the ceiling and honor smaller route limits", async () => {
  const app = Fastify({ bodyLimit: MAX_REQUEST_BYTES * 2 });
  installRuntimeControls(app);
  let handled = 0;
  app.post("/body", async (request) => {
    handled++;
    return request.body;
  });
  app.post("/small", { bodyLimit: 32 }, async (request) => {
    handled++;
    return request.body;
  });
  app.post(
    "/large-route",
    { bodyLimit: MAX_REQUEST_BYTES * 2 },
    async (request) => {
      handled++;
      return request.body;
    },
  );
  try {
    const exact = JSON.stringify({ text: "x".repeat(MAX_REQUEST_BYTES - 11) });
    assert.equal(Buffer.byteLength(exact), MAX_REQUEST_BYTES);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/body",
          headers: { "content-type": "application/json" },
          payload: exact,
        })
      ).statusCode,
      200,
    );
    for (const url of ["/body", "/large-route"]) {
      checkEnvelope(
        await app.inject({
          method: "POST",
          url,
          payload: { text: "x".repeat(MAX_REQUEST_BYTES) },
        }),
        "request_too_large",
        413,
        false,
      );
    }
    checkEnvelope(
      await app.inject({
        method: "POST",
        url: "/small",
        payload: { text: "é".repeat(20) },
      }),
      "request_too_large",
      413,
      false,
    );
    assert.equal(handled, 1);
  } finally {
    await app.close();
  }
});

test("real HTTP chunked uploads count UTF-8 bytes and reject oversized streams before the handler", async () => {
  const app = Fastify({ bodyLimit: MAX_REQUEST_BYTES });
  installRuntimeControls(app, { bodyLimit: 64 });
  let handled = 0;
  app.post("/body", async (request) => {
    handled++;
    return {
      body: request.body,
      lengthWasPresent: request.headers["content-length"] !== undefined,
    };
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const send = (body: Buffer, stride: number) =>
    new Promise<{
      status: number;
      headers: Record<string, unknown>;
      body: string;
    }>((resolve, reject) => {
      const request = httpRequest(
        origin + "/body",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "transfer-encoding": "chunked",
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.once("error", reject);
          response.once("end", () =>
            resolve({
              status: response.statusCode!,
              headers: response.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      request.setTimeout(5_000, () =>
        request.destroy(new Error("test_http_timeout")),
      );
      request.once("error", reject);
      for (let offset = 0; offset < body.length; offset += stride)
        request.write(body.subarray(offset, offset + stride));
      request.end();
    });
  try {
    const text = "é".repeat(26);
    const valid = await send(Buffer.from(JSON.stringify({ text })), 1);
    assert.equal(valid.status, 200);
    assert.deepEqual(JSON.parse(valid.body), {
      body: { text },
      lengthWasPresent: false,
    });
    const oversized = await send(
      Buffer.from(JSON.stringify({ text: "é".repeat(27) })),
      7,
    );
    checkEnvelope(
      {
        statusCode: oversized.status,
        headers: oversized.headers,
        json: () => JSON.parse(oversized.body),
      },
      "request_too_large",
      413,
      false,
    );
    assert.equal(handled, 1);
  } finally {
    await app.close();
  }
});

test("malformed JSON, prototype poisoning, content-length mismatch and unsupported media receive safe errors", async () => {
  const app = Fastify();
  installRuntimeControls(app, { bodyLimit: 128 });
  let handled = 0;
  app.post("/body", async (request) => {
    handled++;
    return request.body;
  });
  try {
    for (const payload of [
      "{",
      "",
      '{"secret":PRIVATE_TOKEN}',
      '{"__proto__":{"admin":true}}',
      '{"constructor":{"prototype":{"admin":true}}}',
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/body",
        headers: { "content-type": "application/json" },
        payload,
      });
      checkEnvelope(response, "invalid_request", 400, false);
      assert.doesNotMatch(response.body, /PRIVATE_TOKEN|__proto__|constructor/);
    }
    checkEnvelope(
      await app.inject({
        method: "POST",
        url: "/body",
        headers: { "content-type": "application/json", "content-length": "1" },
        payload: "{}",
      }),
      "invalid_request",
      400,
      false,
    );
    checkEnvelope(
      await app.inject({
        method: "POST",
        url: "/body",
        headers: { "content-type": "application/x-private" },
        payload: "PRIVATE_TOKEN",
      }),
      "unsupported_media_type",
      415,
      false,
    );
    assert.equal(handled, 0);
  } finally {
    await app.close();
  }
});

test("two instances atomically share a route quota across IDs and query strings", async () => {
  const memory = new MemoryDb();
  const apps = [Fastify(), Fastify()];
  for (const app of apps) {
    installRuntimeControls(app, { database: memory.db });
    app.get(
      "/limited/:id",
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async () => ({ ok: true }),
    );
  }
  try {
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        apps[index % 2]!.inject("/limited/" + index + "?nonce=" + index),
      ),
    );
    assert.equal(
      responses.filter((response) => response.statusCode === 200).length,
      5,
    );
    const denied = responses.filter((response) => response.statusCode === 429);
    assert.equal(denied.length, 7);
    for (const response of denied) {
      checkEnvelope(response, "rate_limit_exceeded", 429, true);
      assert.equal(response.headers["x-ratelimit-limit"], "5");
      assert.equal(response.headers["x-ratelimit-remaining"], "0");
      assert.ok(
        Number(response.headers["retry-after"]) >= 1 &&
          Number(response.headers["retry-after"]) <= 60,
      );
    }
    assert.equal(memory.rows("rate_buckets").length, 2);
    assert.ok(
      memory
        .rows("rate_buckets")
        .every((row) => row.current === 12 && /^[a-f0-9]{64}$/.test(row._id)),
    );
    assert.equal(
      (
        await apps[0]!.inject({
          url: "/limited/fresh",
          remoteAddress: "192.0.2.8",
        })
      ).statusCode,
      200,
    );
  } finally {
    await Promise.all(apps.map((app) => app.close()));
  }
});

test("the global quota spans distinct routes and instances, while explicit false exempts a route", async () => {
  const memory = new MemoryDb();
  const apps = [Fastify(), Fastify()];
  for (const app of apps) {
    installRuntimeControls(app, { database: memory.db });
    app.get("/a", async () => ({ ok: true }));
    app.get("/b", async () => ({ ok: true }));
    app.get("/health", { config: { rateLimit: false } }, async () => ({
      status: "ok",
    }));
  }
  try {
    const responses = await Promise.all(
      Array.from({ length: 121 }, (_, index) =>
        apps[index % 2]!.inject(index % 3 ? "/a" : "/b"),
      ),
    );
    assert.equal(
      responses.filter((response) => response.statusCode === 200).length,
      120,
    );
    assert.equal(
      responses.filter((response) => response.statusCode === 429).length,
      1,
    );
    assert.equal((await apps[1]!.inject("/health")).statusCode, 200);
    assert.equal(memory.rows("rate_buckets")[0]!.current, 121);
  } finally {
    await Promise.all(apps.map((app) => app.close()));
  }
});

test("route settings support dynamic quotas, shared groups, short units and private keys without persisting identities", async () => {
  const memory = new MemoryDb();
  const app = Fastify();
  installRuntimeControls(app, { database: memory.db });
  const settings = {
    max: async () => 1,
    timeWindow: async () => 60_000,
    keyGenerator: async () => "PRIVATE_WALLET_TOKEN",
    groupId: "same-budget",
  };
  app.get("/a", { config: { rateLimit: settings } }, async () => ({
    ok: true,
  }));
  app.get("/b", { config: { rateLimit: settings } }, async () => ({
    ok: true,
  }));
  app.get(
    "/short",
    { config: { rateLimit: { max: 1, timeWindow: "30s" } } },
    async () => ({ ok: true }),
  );
  app.get(
    "/hours",
    { config: { rateLimit: { max: 0, timeWindow: "1h" } } },
    async () => ({ ok: true }),
  );
  try {
    assert.equal((await app.inject("/a")).statusCode, 200);
    assert.equal((await app.inject("/b")).statusCode, 429);
    assert.equal((await app.inject("/short")).statusCode, 200);
    assert.equal((await app.inject("/short")).statusCode, 429);
    const blocked = await app.inject("/hours");
    assert.equal(blocked.statusCode, 429);
    assert.ok(Number(blocked.headers["retry-after"]) <= 3_600);
    assert.doesNotMatch(
      JSON.stringify(memory.rows("rate_buckets")),
      /PRIVATE|same-budget|127\.0\.0\.1|\/short|\/hours/,
    );
  } finally {
    await app.close();
  }
});

test("fixed windows reset without waiting for TTL deletion and old buckets cannot bypass a current quota", async (context) => {
  context.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-20T00:00:59.000Z"),
  });
  const memory = new MemoryDb();
  const app = Fastify();
  installRuntimeControls(app, { database: memory.db });
  app.get(
    "/limited",
    { config: { rateLimit: { max: 1, timeWindow: "1m" } } },
    async () => ({ ok: true }),
  );
  try {
    assert.equal((await app.inject("/limited")).statusCode, 200);
    assert.equal((await app.inject("/limited")).statusCode, 429);
    context.mock.timers.tick(1_001);
    assert.equal((await app.inject("/limited")).statusCode, 200);
    assert.equal((await app.inject("/limited")).statusCode, 429);
    assert.equal(memory.rows("rate_buckets").length, 4);
  } finally {
    await app.close();
  }
});

test("a shared store outage fails closed and rejects invalid static rate configurations at registration", async () => {
  const db = {
    collection() {
      throw new Error("mongodb://private:SECRET@internal/");
    },
  } as unknown as Db;
  const app = Fastify();
  installRuntimeControls(app, { database: db });
  let handled = 0;
  app.get("/body", async () => {
    handled++;
    return { ok: true };
  });
  try {
    for (let index = 0; index < 3; index++) {
      const response = await app.inject("/body");
      checkEnvelope(response, "rate_limit_store_unavailable", 503, true);
      assert.doesNotMatch(response.body, /SECRET|mongodb|internal/);
    }
    assert.equal(handled, 0);
  } finally {
    await app.close();
  }
  for (const rateLimit of [
    { max: 1, timeWindow: "not a duration" },
    { max: 1, timeWindow: 0 },
    { max: 1, timeWindow: NaN },
    { max: -1 },
    { max: 1.5 },
    { max: 1, skipOnError: true },
  ]) {
    const invalid = Fastify();
    installRuntimeControls(invalid);
    assert.throws(
      () =>
        invalid.get("/invalid", { config: { rateLimit } }, async () => ({})),
      /rate_limit_configuration/,
    );
    await invalid.close();
  }
});

test("a unique-key insertion race retries the rate increment exactly once", async () => {
  const memory = new MemoryDb();
  let raced = false;
  const db = {
    collection(name: string) {
      const collection = memory.collection(name);
      return {
        ...collection,
        async findOneAndUpdate(query: any, update: any, options: any) {
          if (!raced && options.upsert) {
            raced = true;
            await collection.insertOne({
              _id: query._id,
              current: 0,
              ...update.$setOnInsert,
            });
            throw Object.assign(new Error("duplicate"), { code: 11000 });
          }
          return collection.findOneAndUpdate(query, update, options);
        },
      };
    },
  } as unknown as Db;
  const app = Fastify();
  installRuntimeControls(app, { database: db });
  app.get(
    "/limited",
    { config: { rateLimit: { max: 1, timeWindow: 60_000 } } },
    async () => ({ ok: true }),
  );
  try {
    assert.equal((await app.inject("/limited")).statusCode, 200);
    assert.equal((await app.inject("/limited")).statusCode, 429);
    assert.ok(memory.rows("rate_buckets").every((row) => row.current === 2));
  } finally {
    await app.close();
  }
});

test("pagination rejects malformed, ambiguous and operator-bearing inputs", () => {
  const t = "2026-10-20T00:00:00.000Z";
  assert.deepEqual(parsePage(), { limit: 25 });
  assert.equal(parsePage({ limit: "100" }).limit, 100);
  const valid = encode({ t, i: "record-1" });
  assert.deepEqual(parsePage({ cursor: valid, limit: "1" }), {
    limit: 1,
    cursor: { t, i: "record-1" },
  });
  for (const input of [
    null,
    [],
    42,
    "query",
    { limit: 0 },
    { limit: 101 },
    { limit: "01" },
    { limit: "1.0" },
    { limit: [] },
    { limit: true },
    { limit: NaN },
    { limit: 1.5 },
    { limit: Infinity },
    { cursor: "" },
    { cursor: null },
    { cursor: ["cursor"] },
    { cursor: valid + "=" },
    { cursor: "bad!" },
    { cursor: "a".repeat(501) },
    { cursor: encode({}) },
    { cursor: encode({ t, i: "" }) },
    { cursor: encode({ t, i: { $gt: "" } }) },
    { cursor: encode({ t, i: "a".repeat(161) }) },
    { cursor: encode({ t, i: "bad\nid" }) },
    { cursor: encode({ t: "invalid", i: "a" }) },
    { cursor: encode({ t: "2026-02-30T00:00:00.000Z", i: "a" }) },
    { cursor: encode({ t: "2026-10-20T00:00:00Z", i: "a" }) },
    { cursor: encode({ t, i: "a", extra: true }) },
    { cursor: encode({ i: "a", t }) },
    {
      cursor: Buffer.from('{"t":"' + t + '","i":"a","i":"b"}').toString(
        "base64url",
      ),
    },
  ])
    assert.throws(
      () => parsePage(input),
      (error) => error instanceof ApiError && error.status === 400,
    );
  assert.throws(
    () => pageQuery({ t, i: { $ne: "" } } as any),
    /invalid_page_cursor/,
  );
  assert.throws(() => pageQuery(undefined, 0 as any), /invalid_page_direction/);
});

test("opaque cursors reject alternate base64 encodings of the same bytes", () => {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let exercised = false;
  for (const i of ["a", "aa", "aaa"]) {
    const canonical = encode({ t: "2026-10-20T00:00:00.000Z", i });
    for (const suffix of alphabet) {
      const alias = canonical.slice(0, -1) + suffix;
      if (
        alias === canonical ||
        !Buffer.from(alias, "base64url").equals(
          Buffer.from(canonical, "base64url"),
        )
      )
        continue;
      assert.ok(parsePage({ cursor: canonical }).cursor);
      assert.throws(() => parsePage({ cursor: alias }), /invalid_page_cursor/);
      exercised = true;
    }
  }
  assert.ok(
    exercised,
    "the negative test must include an actual decodable alias",
  );
});

test("all records survive timestamp ties and page boundaries in either direction, scoped to one owner", async () => {
  for (const direction of [-1, 1] as const) {
    const memory = new MemoryDb();
    const rows = Array.from({ length: 43 }, (_, index) => ({
      _id: "record-" + String(index).padStart(3, "0"),
      created_at: new Date(Date.UTC(2026, 9, 20, 0, Math.floor(index / 9))),
      owner: index % 6 ? "owner-a" : "owner-b",
    }));
    for (const row of rows) await memory.collection("records").insertOne(row);
    const expected = await memory
      .collection("records")
      .find({ owner: "owner-a" })
      .sort({ created_at: direction, _id: direction })
      .toArray();
    const seen: string[] = [];
    let token: string | null = null;
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      const page = parsePage(
        token ? { limit: "4", cursor: token } : { limit: "4" },
      );
      const selected = await memory
        .collection("records")
        .find({ owner: "owner-a", ...pageQuery(page.cursor, direction) })
        .sort({ created_at: direction, _id: direction })
        .limit(page.limit + 1)
        .toArray();
      const result = paginateRows(selected, page.limit, (row) => ({
        id: row._id,
      }));
      seen.push(...result.items.map((row) => row.id));
      token = result.nextCursor;
      if (!token) break;
    }
    assert.equal(token, null, "pagination must terminate");
    assert.deepEqual(
      seen,
      expected.map((row) => row._id),
    );
    assert.equal(new Set(seen).size, expected.length);
  }
});

test("pagination fails closed on missing keys or non-monotonic pages and derives cursors before mapping", () => {
  const date = new Date("2026-10-20T00:00:00.000Z");
  const rows = ["c", "b", "a"].map((_id) => ({ _id, created_at: date }));
  const page = paginateRows(rows, 2, () => ({ label: "hidden" }));
  assert.deepEqual(page.items, [{ label: "hidden" }, { label: "hidden" }]);
  assert.equal(parsePage({ cursor: page.nextCursor }).cursor?.i, "b");
  assert.equal(paginateRows(rows, 3).nextCursor, null);
  assert.deepEqual(paginateRows([], 1), { items: [], nextCursor: null });
  assert.deepEqual(
    pageQuery(parsePage({ cursor: page.nextCursor }).cursor).$or?.[1],
    { created_at: date, _id: { $lt: "b" } },
  );
  for (const broken of [
    [rows[0]!, rows[2]!, rows[1]!],
    [rows[0]!, rows[0]!],
    [{ _id: "missing-date" }],
    [{ created_at: date }],
    [{ _id: { toString: () => "opaque-object" }, created_at: date }],
    [{ _id: "invalid-date", created_at: new Date(NaN) }],
  ])
    assert.throws(() => paginateRows(broken, 1), /page_(?:row|order)_invalid/);
  assert.throws(() => paginateRows(rows, 0), /invalid_page_limit/);
  assert.deepEqual(
    rows.map((row) => row._id),
    ["c", "b", "a"],
  );
});
