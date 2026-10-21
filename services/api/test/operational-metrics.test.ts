import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { Db } from "mongodb";
import { ApiError } from "../src/config.js";
import {
  METRIC_NAMES,
  METRIC_OPERATIONS,
  OPERATIONAL_METRICS_COLLECTION,
  measureOperation,
  operationalMetricsSummary,
  recordOperationalMetric,
  type OperationalMetric,
} from "../src/operational-metrics.js";
import { MemoryDb } from "./memory-db.js";

const now = new Date("2026-10-20T15:30:00.000Z");
const event: OperationalMetric = {
  kind: "provider",
  name: "x",
  operation: "read",
  outcome: "success",
  durationMs: 120,
  at: now,
};

test("independent writers aggregate completed attempts atomically with latency, failure and retry counts", async () => {
  const memory = new MemoryDb();
  const dbA = memory.db;
  const dbB = {
    collection: (name: string) => memory.collection(name),
  } as unknown as Db;
  const samples = Array.from({ length: 50 }, (_, index) => ({
    ...event,
    durationMs: index * 100,
    outcome: index % 4 === 0 ? ("failure" as const) : ("success" as const),
    attempt: index > 0 && index % 3 === 0 ? 2 : 1,
  }));
  const stored = await Promise.all(
    samples.map((sample, index) =>
      recordOperationalMetric(index % 2 ? dbA : dbB, sample),
    ),
  );
  assert.ok(stored.every(Boolean));
  const rows = memory.rows(OPERATIONAL_METRICS_COLLECTION);
  assert.equal(rows.length, 1);
  assert.match(rows[0]!._id, /^[0-9a-f]{64}$/);
  assert.equal(rows[0]!.bucket_at.toISOString(), "2026-10-20T15:00:00.000Z");
  assert.equal(rows[0]!.expires_at.toISOString(), "2026-10-28T15:00:00.000Z");
  const summary = await operationalMetricsSummary(memory.db, { now });
  assert.equal(summary.totals.count, samples.length);
  assert.equal(
    summary.totals.successes,
    samples.filter((sample) => sample.outcome === "success").length,
  );
  assert.equal(
    summary.totals.failures,
    samples.filter((sample) => sample.outcome === "failure").length,
  );
  assert.equal(
    summary.totals.retries,
    samples.filter((sample) => sample.attempt > 1).length,
  );
  assert.equal(
    summary.totals.totalDurationMs,
    samples.reduce((sum, sample) => sum + sample.durationMs, 0),
  );
  assert.equal(
    summary.totals.maxDurationMs,
    Math.max(...samples.map((sample) => sample.durationMs)),
  );
  assert.equal(
    summary.totals.averageDurationMs,
    summary.totals.totalDurationMs / samples.length,
  );
  assert.deepEqual(summary.totals.latencyBuckets, {
    below100Ms: 1,
    from100To499Ms: 4,
    from500To999Ms: 5,
    from1000To4999Ms: 40,
    atLeast5000Ms: 0,
  });
  assert.equal(summary.providers.length, 1);
  assert.equal(summary.providers[0]!.name, "x");
  assert.deepEqual(summary.jobs, []);
  assert.deepEqual(summary.requests, []);
  assert.equal(summary.truncated, false);
  assert.equal(summary.discardedRows, 0);
});

test("safe bounded labels support every provider/job class and never persist credentials or free-form context", async () => {
  const memory = new MemoryDb();
  const secret =
    "https://private:SECRET_PASSWORD@rpc.example/path?apiKey=PRIVATE_TOKEN";
  const hostile = {
    ...event,
    name: secret,
    operation: secret,
    headers: { authorization: secret },
    url: secret,
    error: new Error(secret),
    requestId: secret,
  };
  assert.equal(await recordOperationalMetric(memory.db, hostile), true);
  for (const [kind, names] of Object.entries(METRIC_NAMES)) {
    for (const name of names) {
      assert.equal(
        await recordOperationalMetric(memory.db, {
          ...event,
          kind: kind as OperationalMetric["kind"],
          name,
          operation: kind === "job" ? "process" : "request",
        }),
        true,
      );
    }
  }
  assert.equal(
    await recordOperationalMetric(memory.db, {
      ...event,
      name: "gemini",
      operation: "render",
    }),
    true,
  );
  assert.equal(
    await recordOperationalMetric(memory.db, {
      ...event,
      kind: "job",
      name: "artwork",
      operation: "publish",
      outcome: "failure",
      retry: true,
    }),
    true,
  );
  const rows = memory.rows(OPERATIONAL_METRICS_COLLECTION);
  for (const row of rows) {
    assert.ok(
      (
        METRIC_NAMES[row.kind as keyof typeof METRIC_NAMES] as readonly string[]
      ).includes(row.name),
    );
    assert.ok((METRIC_OPERATIONS as readonly string[]).includes(row.operation));
    assert.deepEqual(
      Object.keys(row).filter((key) =>
        ["headers", "url", "error", "requestId"].includes(key),
      ),
      [],
    );
  }
  const summary = await operationalMetricsSummary(memory.db, { now });
  assert.ok(
    summary.providers.some(
      (row) => row.name === "other" && row.operation === "other",
    ),
  );
  assert.ok(
    summary.providers.some(
      (row) => row.name === "gemini" && row.operation === "render",
    ),
  );
  assert.equal(
    summary.jobs.find(
      (row) => row.name === "artwork" && row.operation === "publish",
    )!.retries,
    1,
  );
  assert.ok(summary.requests.some((row) => row.name === "http"));
  assert.doesNotMatch(
    JSON.stringify({ rows, summary }),
    /SECRET_PASSWORD|PRIVATE_TOKEN|rpc\.example|apiKey/,
  );
});

test("instrumentation preserves work values and thrown objects while recording actual outcomes", async () => {
  const memory = new MemoryDb();
  const value = { item: { id: "operation-result" } };
  const result = await measureOperation(
    memory.db,
    { kind: "job", name: "capture", operation: "capture" },
    () => value,
  );
  assert.equal(result, value);
  const failure = Object.assign(new Error("SECRET_PROVIDER_TOKEN"), {
    request: { authorization: "PRIVATE_HEADER" },
  });
  await assert.rejects(
    measureOperation(
      memory.db,
      { kind: "provider", name: "genlayer", operation: "submit", attempt: 2 },
      async () => {
        throw failure;
      },
    ),
    (error) => error === failure,
  );
  const summary = await operationalMetricsSummary(memory.db);
  assert.equal(summary.totals.count, 2);
  assert.equal(summary.totals.successes, 1);
  assert.equal(summary.totals.failures, 1);
  assert.equal(summary.totals.retries, 1);
  assert.ok(summary.totals.totalDurationMs >= 0);
  assert.doesNotMatch(
    JSON.stringify(memory.rows(OPERATIONAL_METRICS_COLLECTION)),
    /SECRET_PROVIDER_TOKEN|PRIVATE_HEADER|authorization|request"/,
  );
});

test("rejected, unavailable and even invalid instrumentation cannot mask real work", async () => {
  const failure = new Error("actual-operation-failure");
  const value = { completed: true };
  for (const db of [
    undefined,
    {
      collection() {
        throw new Error("SECRET_CONNECTION_STRING");
      },
    } as unknown as Db,
    {
      collection() {
        return {
          async updateOne() {
            throw new Error("SECRET_DATABASE_PASSWORD");
          },
        };
      },
    } as unknown as Db,
  ]) {
    assert.equal(await recordOperationalMetric(db, event), false);
    assert.equal(
      await measureOperation(db, { kind: "job", name: "claim" }, () => value),
      value,
    );
    await assert.rejects(
      measureOperation(db, { kind: "job", name: "claim" }, () => {
        throw failure;
      }),
      (error) => error === failure,
    );
  }
  const labels = Object.defineProperty(
    { kind: "job", name: "claim" },
    "operation",
    {
      enumerable: true,
      get() {
        throw new Error("BROKEN_LABEL_GETTER");
      },
    },
  ) as Parameters<typeof measureOperation>[1];
  const memory = new MemoryDb();
  assert.equal(await measureOperation(memory.db, labels, () => value), value);
  await assert.rejects(
    measureOperation(memory.db, labels, () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(memory.rows(OPERATIONAL_METRICS_COLLECTION).length, 0);
});

test("a stalled metric store has a bounded wait and late rejection remains handled", async () => {
  let rejectWrite!: (error: Error) => void;
  const db = {
    collection() {
      return {
        updateOne() {
          return new Promise((_resolve, reject) => {
            rejectWrite = reject;
          });
        },
      };
    },
  } as unknown as Db;
  const value = { committed: true };
  const result = await measureOperation(
    db,
    { kind: "job", name: "artwork", operation: "publish" },
    async () => value,
  );
  assert.equal(result, value);
  assert.equal(typeof rejectWrite, "function");
  rejectWrite(new Error("LATE_SECRET_DATABASE_FAILURE"));
  await setImmediate();
});

test("invalid measurements are discarded, giant durations are bounded and marked honestly", async () => {
  const memory = new MemoryDb();
  for (const invalid of [
    { ...event, durationMs: NaN },
    { ...event, durationMs: Infinity },
    { ...event, durationMs: -1 },
    { ...event, attempt: 0 },
    { ...event, attempt: 1.1 },
    { ...event, attempt: Infinity },
    { ...event, retry: "yes" },
    { ...event, kind: "constructor" },
    { ...event, kind: "__proto__" },
    { ...event, outcome: "unknown" },
    { ...event, at: new Date(NaN) },
  ])
    assert.equal(
      await recordOperationalMetric(memory.db, invalid as OperationalMetric),
      false,
    );
  assert.equal(memory.rows(OPERATIONAL_METRICS_COLLECTION).length, 0);
  assert.equal(
    await recordOperationalMetric(memory.db, {
      ...event,
      durationMs: 10 ** 20,
    }),
    true,
  );
  const summary = await operationalMetricsSummary(memory.db, { now });
  assert.equal(summary.totals.count, 1);
  assert.equal(summary.totals.durationClamped, 1);
  assert.equal(summary.totals.maxDurationMs, 86_400_000);
  assert.equal(summary.totals.latencyBuckets.atLeast5000Ms, 1);
});

test("summary windows use hourly buckets and ignore expired or future buckets even before TTL cleanup", async () => {
  const memory = new MemoryDb();
  for (const at of [
    new Date("2026-10-20T13:59:59Z"),
    new Date("2026-10-20T14:00:00Z"),
    now,
    new Date("2026-10-20T16:00:00Z"),
  ])
    assert.equal(
      await recordOperationalMetric(memory.db, { ...event, at }),
      true,
    );
  const summary = await operationalMetricsSummary(memory.db, { hours: 2, now });
  assert.equal(memory.rows(OPERATIONAL_METRICS_COLLECTION).length, 4);
  assert.equal(summary.totals.count, 2);
  assert.deepEqual(summary.window, {
    from: "2026-10-20T14:00:00.000Z",
    to: now.toISOString(),
    bucketSeconds: 3600,
  });
  for (const options of [
    { hours: 0 },
    { hours: 169 },
    { hours: 1.5 },
    { hours: Infinity },
    { hours: "24" },
    { now: new Date(NaN) },
  ]) {
    await assert.rejects(
      operationalMetricsSummary(memory.db, options as any),
      (error) =>
        error instanceof ApiError &&
        error.code === "invalid_metrics_window" &&
        error.status === 400,
    );
  }
});

test("admin summary returns aggregate fields only, discards corrupted metrics and sanitizes storage failures", async () => {
  const memory = new MemoryDb();
  await recordOperationalMetric(memory.db, event);
  const row = memory.rows(OPERATIONAL_METRICS_COLLECTION)[0]!;
  row.secret = "SECRET_CREDENTIAL_FROM_DATABASE";
  row.headers = { cookie: "PRIVATE_SESSION_COOKIE" };
  row.url = "https://private.example/?token=SECRET_TOKEN";
  await memory
    .collection(OPERATIONAL_METRICS_COLLECTION)
    .insertOne({ ...row, _id: "bad-label", name: "SECRET_CREDENTIAL_LABEL" });
  await memory
    .collection(OPERATIONAL_METRICS_COLLECTION)
    .insertOne({ ...row, _id: "bad-count", count: -1 });
  const summary = await operationalMetricsSummary(memory.db, { now });
  assert.equal(summary.totals.count, 1);
  assert.equal(summary.discardedRows, 2);
  assert.doesNotMatch(
    JSON.stringify(summary),
    /SECRET|PRIVATE_SESSION|private\.example|cookie|headers|_id|url/,
  );
  const unavailable = {
    collection() {
      throw new Error("mongodb://user:SECRET_PASSWORD@private/");
    },
  } as unknown as Db;
  await assert.rejects(operationalMetricsSummary(unavailable), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "metrics_unavailable");
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /SECRET|mongodb|private/);
    return true;
  });
});

test("cold aggregate insertion collisions retry once without losing either writer's event", async () => {
  const memory = new MemoryDb();
  let attempts = 0;
  const db = {
    collection(name: string) {
      const collection = memory.collection(name);
      return {
        ...collection,
        async updateOne(query: any, update: any, options: any) {
          attempts++;
          if (attempts === 1) {
            await collection.updateOne(query, update, options);
            throw Object.assign(
              new Error("duplicate insert by competing writer"),
              { code: 11000 },
            );
          }
          return collection.updateOne(query, update, options);
        },
      };
    },
  } as unknown as Db;
  assert.equal(await recordOperationalMetric(db, event), true);
  assert.equal(attempts, 2);
  const summary = await operationalMetricsSummary(memory.db, { now });
  assert.equal(summary.totals.count, 2);
  assert.equal(summary.totals.totalDurationMs, event.durationMs * 2);
});
