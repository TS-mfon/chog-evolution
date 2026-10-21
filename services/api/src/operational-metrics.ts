import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Db } from "mongodb";
import { ApiError } from "./config.js";

export const OPERATIONAL_METRICS_COLLECTION = "operational_metrics";
export const METRIC_NAMES = {
  provider: [
    "x",
    "github",
    "rpc",
    "genlayer",
    "gemini",
    "media",
    "original_metadata",
    "other",
  ],
  job: ["capture", "claim", "artwork", "scan", "other"],
  request: ["http", "other"],
} as const;
export const METRIC_OPERATIONS = [
  "lookup",
  "read",
  "capture",
  "submit",
  "poll",
  "finalize",
  "render",
  "publish",
  "scan",
  "process",
  "request",
  "other",
] as const;

const HOUR_MS = 3_600_000;
const MAX_HOURS = 168;
const RETENTION_MS = 8 * 24 * HOUR_MS;
const MAX_DURATION_MS = 24 * HOUR_MS;
const STORE_TIMEOUT_MS = 1_000;
const MAX_SERIES =
  Object.values(METRIC_NAMES).reduce((sum, names) => sum + names.length, 0) *
  METRIC_OPERATIONS.length;
const MAX_SUMMARY_ROWS = MAX_SERIES * MAX_HOURS;
const LATENCY_FIELDS = [
  "latency_lt_100_ms",
  "latency_lt_500_ms",
  "latency_lt_1000_ms",
  "latency_lt_5000_ms",
  "latency_gte_5000_ms",
] as const;
type LatencyField = (typeof LATENCY_FIELDS)[number];
type MetricKind = keyof typeof METRIC_NAMES;

export type OperationLabels = {
  kind: MetricKind;
  name: string;
  operation?: string;
  /** A retry means an actual repeated attempt, not merely a scheduled retry. */
  attempt?: number;
  retry?: boolean;
};
export type OperationalMetric = OperationLabels & {
  outcome: "success" | "failure";
  durationMs: number;
  at?: Date;
};
type MetricRow = Record<LatencyField, number> & {
  _id: string;
  kind: MetricKind;
  name: string;
  operation: string;
  bucket_at: Date;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  count: number;
  successes: number;
  failures: number;
  retries: number;
  total_duration_ms: number;
  max_duration_ms: number;
  duration_clamped: number;
};

function labelsFor(input: OperationLabels) {
  if (!Object.hasOwn(METRIC_NAMES, input.kind))
    throw new Error("invalid_metric_kind");
  const names: readonly string[] = METRIC_NAMES[input.kind];
  return {
    kind: input.kind,
    name: names.includes(input.name) ? input.name : "other",
    operation: (METRIC_OPERATIONS as readonly unknown[]).includes(
      input.operation,
    )
      ? input.operation!
      : "other",
  };
}
const metricId = (
  bucket: Date,
  labels: { kind: MetricKind; name: string; operation: string },
) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        bucket.toISOString(),
        labels.kind,
        labels.name,
        labels.operation,
      ]),
    )
    .digest("hex");

async function bounded<T>(
  work: () => Promise<T>,
  timeoutMs = STORE_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("metrics_store_unavailable")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Persist one completed attempt as an hourly aggregate. No identities, URLs,
 * exception messages, request bodies, credentials or free-form labels are stored.
 * A failed write returns false; telemetry must never fail the measured operation.
 */
export async function recordOperationalMetric(
  db: Db | undefined,
  input: OperationalMetric,
): Promise<boolean> {
  if (!db) return false;
  try {
    const labels = labelsFor(input);
    if (input.outcome !== "success" && input.outcome !== "failure")
      return false;
    if (
      typeof input.durationMs !== "number" ||
      !Number.isFinite(input.durationMs) ||
      input.durationMs < 0
    )
      return false;
    if (
      input.attempt !== undefined &&
      (!Number.isSafeInteger(input.attempt) || input.attempt < 1)
    )
      return false;
    if (input.retry !== undefined && typeof input.retry !== "boolean")
      return false;
    const now = input.at ?? new Date();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
    const bucket = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
    const duration = Math.round(Math.min(MAX_DURATION_MS, input.durationMs));
    const latency =
      duration < 100
        ? 0
        : duration < 500
          ? 1
          : duration < 1_000
            ? 2
            : duration < 5_000
              ? 3
              : 4;
    const histogram = Object.fromEntries(
      LATENCY_FIELDS.map((field, index) => [field, index === latency ? 1 : 0]),
    ) as Record<LatencyField, number>;
    const id = metricId(bucket, labels);
    const update = {
      $inc: {
        count: 1,
        successes: input.outcome === "success" ? 1 : 0,
        failures: input.outcome === "failure" ? 1 : 0,
        retries: input.retry === true || (input.attempt ?? 1) > 1 ? 1 : 0,
        total_duration_ms: duration,
        duration_clamped: input.durationMs > MAX_DURATION_MS ? 1 : 0,
        ...histogram,
      },
      $max: { max_duration_ms: duration },
      $set: { updated_at: now },
      $setOnInsert: {
        ...labels,
        bucket_at: bucket,
        created_at: now,
        expires_at: new Date(bucket.getTime() + RETENTION_MS),
      },
    };
    await bounded(async () => {
      const collection = db.collection<MetricRow>(
        OPERATIONAL_METRICS_COLLECTION,
      );
      try {
        await collection.updateOne({ _id: id }, update, {
          upsert: true,
          timeoutMS: STORE_TIMEOUT_MS,
          maxTimeMS: STORE_TIMEOUT_MS,
        });
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code !== 11000) throw error;
        // A competing cold writer inserted the aggregate first. The failed
        // insert did not count its event, so apply that event exactly once.
        const result = await collection.updateOne({ _id: id }, update, {
          timeoutMS: STORE_TIMEOUT_MS,
          maxTimeMS: STORE_TIMEOUT_MS,
        });
        if (result.matchedCount !== 1)
          throw new Error("metrics_store_unavailable");
      }
    });
    return true;
  } catch {
    return false;
  }
}

/** Preserve the work's exact value/error even when instrumentation itself fails. */
export async function measureOperation<T>(
  db: Db | undefined,
  labels: OperationLabels,
  work: () => Promise<T> | T,
): Promise<T> {
  const started = performance.now();
  const record = async (outcome: OperationalMetric["outcome"]) => {
    try {
      await recordOperationalMetric(db, {
        ...labels,
        outcome,
        durationMs: Math.max(0, performance.now() - started),
      });
    } catch {
      // Also guard against invalid/proxy label objects supplied by a caller.
    }
  };
  let value: T;
  try {
    value = await work();
  } catch (error) {
    await record("failure");
    throw error;
  }
  await record("success");
  return value;
}

function emptyTotals() {
  return {
    count: 0,
    successes: 0,
    failures: 0,
    retries: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    durationClamped: 0,
    latencyBuckets: {
      below100Ms: 0,
      from100To499Ms: 0,
      from500To999Ms: 0,
      from1000To4999Ms: 0,
      atLeast5000Ms: 0,
    },
  };
}
type Totals = ReturnType<typeof emptyTotals>;
const add = (left: number, right: number) =>
  Math.min(Number.MAX_SAFE_INTEGER, left + right);
function accumulate(total: Totals, row: MetricRow): void {
  total.count = add(total.count, row.count);
  total.successes = add(total.successes, row.successes);
  total.failures = add(total.failures, row.failures);
  total.retries = add(total.retries, row.retries);
  total.totalDurationMs = add(total.totalDurationMs, row.total_duration_ms);
  total.maxDurationMs = Math.max(total.maxDurationMs, row.max_duration_ms);
  total.durationClamped = add(total.durationClamped, row.duration_clamped);
  const keys = Object.keys(
    total.latencyBuckets,
  ) as (keyof Totals["latencyBuckets"])[];
  LATENCY_FIELDS.forEach((field, index) => {
    const key = keys[index]!;
    total.latencyBuckets[key] = add(total.latencyBuckets[key], row[field]);
  });
}
function present(total: Totals) {
  return {
    ...total,
    averageDurationMs: total.count
      ? Math.round((total.totalDurationMs / total.count) * 100) / 100
      : 0,
  };
}
function validRow(row: MetricRow): boolean {
  if (!row || !Object.hasOwn(METRIC_NAMES, row.kind)) return false;
  if (
    !(METRIC_NAMES[row.kind] as readonly string[]).includes(row.name) ||
    !(METRIC_OPERATIONS as readonly string[]).includes(row.operation)
  )
    return false;
  const counters = [
    row.count,
    row.successes,
    row.failures,
    row.retries,
    row.total_duration_ms,
    row.max_duration_ms,
    row.duration_clamped,
    ...LATENCY_FIELDS.map((field) => row[field]),
  ];
  return (
    counters.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    row.count === row.successes + row.failures &&
    row.retries <= row.count &&
    row.duration_clamped <= row.count &&
    row.max_duration_ms <= MAX_DURATION_MS &&
    row.count === LATENCY_FIELDS.reduce((sum, field) => sum + row[field], 0)
  );
}

/**
 * Aggregate-only data for an already authenticated admin route. The current
 * partial hour and preceding hours are included; no raw documents are returned.
 */
export async function operationalMetricsSummary(
  db: Db,
  options: { hours?: number; now?: Date } = {},
) {
  const hours = options.hours ?? 24;
  const now = options.now ?? new Date();
  if (
    !Number.isSafeInteger(hours) ||
    hours < 1 ||
    hours > MAX_HOURS ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  )
    throw new ApiError("invalid_metrics_window", 400);
  const from = new Date(
    Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - (hours - 1) * HOUR_MS,
  );
  let rows: MetricRow[];
  try {
    const projection = Object.fromEntries(
      [
        "kind",
        "name",
        "operation",
        "bucket_at",
        "count",
        "successes",
        "failures",
        "retries",
        "total_duration_ms",
        "max_duration_ms",
        "duration_clamped",
        ...LATENCY_FIELDS,
      ].map((key) => [key, 1]),
    );
    rows = await bounded(
      () =>
        db
          .collection<MetricRow>(OPERATIONAL_METRICS_COLLECTION)
          .find(
            { bucket_at: { $gte: from, $lte: now } },
            { projection, timeoutMS: 2_000, maxTimeMS: 2_000 },
          )
          .sort({ bucket_at: -1, _id: 1 })
          .limit(MAX_SUMMARY_ROWS + 1)
          .toArray(),
      2_000,
    );
  } catch {
    throw new ApiError("metrics_unavailable", 503);
  }
  const totals = emptyTotals();
  const groups = new Map<
    string,
    { kind: MetricKind; name: string; operation: string; totals: Totals }
  >();
  let discardedRows = 0;
  for (const row of rows.slice(0, MAX_SUMMARY_ROWS)) {
    if (!validRow(row)) {
      discardedRows++;
      continue;
    }
    accumulate(totals, row);
    const key = [row.kind, row.name, row.operation].join(":");
    let group = groups.get(key);
    if (!group) {
      group = {
        kind: row.kind,
        name: row.name,
        operation: row.operation,
        totals: emptyTotals(),
      };
      groups.set(key, group);
    }
    accumulate(group.totals, row);
  }
  const list = (kind: MetricKind) =>
    [...groups.values()]
      .filter((group) => group.kind === kind)
      .sort((left, right) => {
        const a = left.name + ":" + left.operation,
          b = right.name + ":" + right.operation;
        return a < b ? -1 : a > b ? 1 : 0;
      })
      .map((group) => ({
        name: group.name,
        operation: group.operation,
        ...present(group.totals),
      }));
  return {
    observedAt: now.toISOString(),
    window: {
      from: from.toISOString(),
      to: now.toISOString(),
      bucketSeconds: 3_600,
    },
    totals: present(totals),
    providers: list("provider"),
    jobs: list("job"),
    requests: list("request"),
    truncated: rows.length > MAX_SUMMARY_ROWS,
    discardedRows,
  };
}
