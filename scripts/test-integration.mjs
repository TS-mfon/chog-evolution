import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUITE = "chog-persistence-v3";
const OWNER_COLLECTION = "_integration_owner";

export function validateTestDatabaseName(name, expectedName = name) {
  if (
    typeof name !== "string" ||
    !/^chog_test_[0-9a-f]{24}$/.test(name) ||
    name !== expectedName
  )
    throw new Error("unsafe_test_database");
}

export async function assertOwnedDatabase(db, expectedName, runId) {
  validateTestDatabaseName(db.databaseName, expectedName);
  if (typeof runId !== "string" || !/^[0-9a-f-]{36}$/.test(runId))
    throw new Error("test_database_ownership_mismatch");
  const marker = await db
    .collection(OWNER_COLLECTION)
    .findOne({ _id: "owner" });
  if (
    !marker ||
    marker.suite !== SUITE ||
    marker.database !== expectedName ||
    marker.run_id !== runId
  )
    throw new Error("test_database_ownership_mismatch");
}

export async function dropOwnedDatabase(db, expectedName, runId) {
  await assertOwnedDatabase(db, expectedName, runId);
  assert.equal(await db.dropDatabase(), true, "test_database_drop_failed");
  assert.equal(
    (await db.listCollections({}, { nameOnly: true }).toArray()).length,
    0,
    "test_database_cleanup_incomplete",
  );
}

function redactor(uri) {
  const values = [uri];
  const authority = uri.match(/^mongodb(?:\+srv)?:\/\/([^@/]+)@/i)?.[1];
  if (authority)
    for (const value of authority.split(":")) {
      if (value) values.push(value);
      try {
        const decoded = decodeURIComponent(value);
        if (decoded) values.push(decoded);
      } catch {}
    }
  return (value) => {
    let safe = String(value);
    for (const secret of values.sort((a, b) => b.length - a.length))
      safe = safe.split(secret).join("[redacted]");
    return safe.replace(
      /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,
      "[redacted-mongodb-uri]",
    );
  };
}

async function runChild(args, env, redact, onMessage, timeoutMs) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const buffers = new Map([
    [child.stdout, ""],
    [child.stderr, ""],
  ]);
  let outputBytes = 0;
  let overflow = false;
  for (const [stream] of buffers)
    stream.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 2 * 1024 * 1024) {
        overflow = true;
        child.kill("SIGTERM");
        return;
      }
      const pending = buffers.get(stream) + String(chunk);
      const lines = pending.split("\n");
      buffers.set(stream, lines.pop());
      for (const line of lines) {
        const target =
          stream === child.stderr ? process.stderr : process.stdout;
        target.write(redact(line) + "\n");
      }
    });
  child.on("message", (message) => onMessage?.(message));
  let timedOut = false;
  let killTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  }, timeoutMs);
  const forwardSignal = () => child.kill("SIGTERM");
  process.once("SIGINT", forwardSignal);
  process.once("SIGTERM", forwardSignal);
  try {
    const result = await new Promise((resolveChild, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolveChild({ code, signal }));
    });
    for (const [stream, pending] of buffers)
      if (pending) {
        (stream === child.stderr ? process.stderr : process.stdout).write(
          redact(pending) + "\n",
        );
      }
    if (timedOut || overflow || result.code !== 0)
      throw new Error(
        timedOut
          ? "persistence_test_timeout"
          : overflow
            ? "persistence_output_limit"
            : "persistence_child_failed",
      );
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    process.removeListener("SIGINT", forwardSignal);
    process.removeListener("SIGTERM", forwardSignal);
  }
}

async function main() {
  const uri = process.env.MONGODB_TEST_URI;
  if (!uri || !/^mongodb(?:\+srv)?:\/\//i.test(uri))
    throw new Error("mongodb_test_uri_required");
  const redact = redactor(uri);
  const name = "chog_test_" + randomBytes(12).toString("hex");
  const runId = randomUUID();
  validateTestDatabaseName(name);
  const env = { ...process.env };
  // The child must not accidentally discover production provider credentials or
  // a default application database through a repository constructor.
  for (const key of Object.keys(env)) {
    if (
      key !== "MONGODB_TEST_URI" &&
      (/PRIVATE_KEY|API_KEY|BEARER_TOKEN|SECRET/.test(key) ||
        ["MONGODB_URI", "MONGODB_DATABASE"].includes(key))
    )
      delete env[key];
  }
  Object.assign(env, {
    MONGODB_URI: "",
    MONGODB_DATABASE: name,
    CHOG_INTEGRATION_DATABASE: name,
    CHOG_INTEGRATION_RUN_ID: runId,
    NODE_ENV: "test",
    ENABLE_LOCAL_DEMO_SCENARIOS: "false",
  });
  await runChild(
    [
      "node_modules/typescript/bin/tsc",
      "--project",
      "services/api/tsconfig.json",
    ],
    env,
    redact,
    undefined,
    120_000,
  );
  const client = new MongoClient(uri, {
    appName: "chog-isolated-persistence-runner",
    maxPoolSize: 4,
    serverSelectionTimeoutMS: 15_000,
    connectTimeoutMS: 15_000,
  });
  let db;
  let owned = false;
  let summary;
  let failure;
  try {
    await client.connect();
    db = client.db(name);
    const hello = await db.command({ hello: 1 });
    if (!hello.setName || !hello.logicalSessionTimeoutMinutes)
      throw new Error("mongodb_replica_set_required");
    if ((await db.listCollections({}, { nameOnly: true }).toArray()).length)
      throw new Error("test_database_collision");
    await db.collection(OWNER_COLLECTION).insertOne({
      _id: "owner",
      suite: SUITE,
      database: name,
      run_id: runId,
      created_at: new Date(),
    });
    owned = true;
    await assertOwnedDatabase(db, name, runId);
    console.log("PERSISTENCE isolated replica-set database created");
    await runChild(
      ["--import", "tsx", "services/api/test/persistence.integration.ts"],
      env,
      redact,
      (message) => {
        if (message?.type === "persistence-summary" && message.runId === runId)
          summary = message;
      },
      15 * 60_000,
    );
    assert.ok(
      summary && Number.isSafeInteger(summary.cases) && summary.cases >= 15,
      "persistence_case_summary_missing",
    );
    assert.ok(
      Array.isArray(summary.collections) && summary.collections.length >= 32,
      "persistence_collection_summary_missing",
    );
  } catch (error) {
    failure = error;
  } finally {
    if (owned && db) {
      try {
        await dropOwnedDatabase(db, name, runId);
        console.log("PERSISTENCE owned database cleanup verified");
      } catch {
        failure = new Error("test_database_cleanup_failed");
      }
    }
    await client.close();
  }
  if (failure) throw failure;
  console.log(
    "PERSISTENCE VERIFIED " +
      JSON.stringify({
        cases: summary.cases,
        collections: summary.collections.length,
        cleanup: "verified",
      }),
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    const code =
      error instanceof Error && /^[a-z_]+$/.test(error.message)
        ? error.message
        : "persistence_runner_failed";
    console.error("PERSISTENCE FAILED " + code);
    process.exitCode = 1;
  });
}
