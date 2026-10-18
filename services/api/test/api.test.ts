import { strict as assert } from "node:assert";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type {
  ScenarioOutcome,
  ScenarioRecord,
  ScenarioRepository,
} from "../src/repository.js";

process.env.NODE_ENV = "test";
process.env.ENABLE_LOCAL_DEMO_SCENARIOS = "true";
const { buildApp } = await import("../src/index.js");

// This repository is explicitly simulated and isolates local walkthrough HTTP semantics.
class TestRepository implements ScenarioRepository {
  private readonly byKey = new Map<string, ScenarioRecord>();
  async createOrGet(key: string, outcome: ScenarioOutcome) {
    const existing = this.byKey.get(key);
    if (existing) return { record: existing, duplicate: true };
    const accepted = outcome === "accepted";
    const record: ScenarioRecord = {
      id: randomUUID(),
      outcome,
      simulated: true,
      stateKind: "local_simulation",
      createdAt: new Date().toISOString(),
      profile: {
        id: randomUUID(),
        xp: accepted ? 100 : 0,
        level: accepted ? 2 : 1,
        stage: accepted ? "curious" : "hatchling",
        version: accepted ? 1 : 0,
      },
      claim: {
        id: randomUUID(),
        status: outcome === "pending" ? "verifying" : outcome,
      },
      evolution: {
        status: accepted
          ? "simulated"
          : outcome === "pending"
            ? "pending"
            : "not_awarded",
        xpAward: accepted ? 100 : 0,
      },
    };
    this.byKey.set(key, record);
    return { record, duplicate: false };
  }
  async get(id: string) {
    return [...this.byKey.values()].find((record) => record.id === id);
  }
}

const app = buildApp(new TestRepository());
before(async () => app.ready());
after(async () => app.close());

test("unconfigured live providers expose no quests or claims", async () => {
  const quests = await app.inject({ method: "GET", url: "/v1/quests" });
  assert.deepEqual(quests.json().items, []);
  const claim = await app.inject({
    method: "POST",
    url: "/v1/claims",
    payload: {},
  });
  assert.equal(claim.statusCode, 503);
  const scan = await app.inject({
    method: "POST",
    url: "/v1/scans",
    payload: { profileId: randomUUID() },
  });
  assert.equal(scan.statusCode, 503);
  assert.equal(scan.json().error, "scan_database_unconfigured");
});

test("wallet identity and profile writes fail closed without a database", async () => {
  const nonce = await app.inject({
    method: "POST",
    url: "/v1/auth/nonce",
    payload: {
      address: "0x0000000000000000000000000000000000000001",
      chainId: 10143,
    },
  });
  assert.equal(nonce.statusCode, 503);
  assert.equal(nonce.json().error, "auth_database_unconfigured");
  const profiles = await app.inject({ method: "GET", url: "/v1/profiles" });
  assert.equal(profiles.statusCode, 503);
});

test("quest administration and manual review fail closed without configured storage and credentials", async () => {
  const quest = await app.inject({
    method: "POST",
    url: "/v1/admin/quests",
    payload: {},
  });
  assert.equal(quest.statusCode, 503);
  assert.equal(quest.json().error, "quest_admin_unconfigured");
  const queue = await app.inject({
    method: "GET",
    url: "/v1/admin/claims/review",
  });
  assert.equal(queue.statusCode, 503);
  assert.equal(queue.json().error, "quest_admin_unconfigured");
});

test("scenario outcomes persist and idempotency replays original result", async () => {
  for (const outcome of ["accepted", "rejected", "pending"] as const) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/dev/scenarios",
      headers: { "Idempotency-Key": outcome },
      payload: { outcome },
    });
    assert.equal(response.statusCode, 201);
    const scenario = response.json();
    assert.equal(scenario.simulated, true);
    assert.equal(scenario.stateKind, "local_simulation");
    assert.equal(scenario.outcome, outcome);
    assert.equal(
      scenario.claim.status,
      outcome === "pending" ? "verifying" : outcome,
    );
    assert.equal(
      scenario.evolution.status,
      outcome === "accepted"
        ? "simulated"
        : outcome === "pending"
          ? "pending"
          : "not_awarded",
    );
    assert.ok(
      scenario.id && scenario.profile && scenario.claim && scenario.evolution,
    );
    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/dev/scenarios",
      headers: { "Idempotency-Key": outcome },
      payload: { outcome: "accepted" },
    });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(duplicate.json().duplicate, true);
    assert.equal(duplicate.json().id, scenario.id);
    assert.equal(duplicate.json().outcome, outcome);
    const fetched = await app.inject({
      method: "GET",
      url: `/v1/dev/scenarios/${scenario.id}`,
    });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.json().id, scenario.id);
    assert.equal(fetched.json().simulated, true);
  }
});
