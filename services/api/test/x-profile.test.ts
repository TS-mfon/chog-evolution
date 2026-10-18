import { strict as assert } from "node:assert";
import { test } from "node:test";
import { lookupPublicXProfile } from "../src/x-profile.js";

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("looks up the exact public X profile through the official API", async () => {
  let called = "";
  const profile = await lookupPublicXProfile("ChogNFT", "test-token", async (url, init) => {
    called = String(url);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
    return response(200, { data: { id: "1234", username: "ChogNFT", description: "Monad native Chog" } });
  });
  assert.match(called, /^https:\/\/api\.x\.com\/2\/users\/by\/username\/ChogNFT/);
  assert.deepEqual(profile, { id: "1234", username: "ChogNFT", description: "Monad native Chog" });
});

test("returns missing accounts and refuses malformed provider data", async () => {
  assert.equal(await lookupPublicXProfile("missing", "token", async () => response(404, {})), null);
  await assert.rejects(lookupPublicXProfile("person", "token", async () => response(200, { data: { id: "not-a-number", username: "person", description: "" } })), /invalid_profile/);
  assert.equal(await lookupPublicXProfile("person", "token", async () => response(200, { data: { id: "12", username: "different", description: "bio" } })), null);
});
