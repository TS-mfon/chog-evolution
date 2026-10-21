import { strict as assert } from "node:assert";
import { test, type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { lookupPublicXProfile, lookupXProfile } from "../src/x-profile.js";
import {
  parseXProfile,
  X_PARSER_VERSION,
  xSourceMode,
} from "../src/public-x.js";
import { ApiError } from "../src/config.js";

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("looks up the exact public X profile through the official API", async () => {
  let called = "";
  const profile = await lookupPublicXProfile(
    "ChogNFT",
    "test-token",
    async (url, init) => {
      called = String(url);
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-token",
      );
      return response(200, {
        data: {
          id: "1234",
          username: "ChogNFT",
          description: "Monad native Chog",
        },
      });
    },
  );
  assert.match(
    called,
    /^https:\/\/api\.x\.com\/2\/users\/by\/username\/ChogNFT/,
  );
  assert.deepEqual(profile, {
    id: "1234",
    username: "ChogNFT",
    description: "Monad native Chog",
  });
});

test("returns missing accounts and refuses malformed provider data", async () => {
  assert.equal(
    await lookupPublicXProfile("missing", "token", async () =>
      response(404, {}),
    ),
    null,
  );
  await assert.rejects(
    lookupPublicXProfile("person", "token", async () =>
      response(200, {
        data: { id: "not-a-number", username: "person", description: "" },
      }),
    ),
    /invalid_profile/,
  );
  assert.equal(
    await lookupPublicXProfile("person", "token", async () =>
      response(200, {
        data: { id: "12", username: "different", description: "bio" },
      }),
    ),
    null,
  );
});

function environment(
  t: TestContext,
  values: Record<string, string | undefined>,
) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}
const page = (profile: any) =>
  `<script type="application/json">${JSON.stringify({ data: { user_result_by_screen_name: { result: profile } } })}</script>`;
const currentProfile = () => ({
  __typename: "User",
  rest_id: "1234",
  core: { screen_name: "ChogNFT" },
  profile_bio: { description: "Bio verification CHOG-ABC123" },
});
const code = (expected: string) => (error: unknown) =>
  error instanceof ApiError && error.code === expected;

test("profile lookup defaults to public pages even when a legacy API key exists", async (t) => {
  environment(t, {
    X_SOURCE_MODE: undefined,
    X_API_BEARER_TOKEN: "unused-api-key",
  });
  assert.equal(xSourceMode(), "public_page");
  const calls: string[] = [];
  const profile = await lookupXProfile("ChogNFT", async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    assert.equal(new Headers(init?.headers).get("cookie"), null);
    return new Response(page(currentProfile()));
  });
  assert.deepEqual(calls, ["https://x.com/ChogNFT"]);
  assert.ok(profile);
  assert.equal(profile.id, "1234");
  assert.equal(profile.description, "Bio verification CHOG-ABC123");
  assert.equal(profile.source.method, "public_x_profile_snapshot");
  assert.equal(profile.source.parserVersion, X_PARSER_VERSION);
  assert.ok(Number.isFinite(Date.parse(profile.source.fetchedAt)));
  assert.equal(
    profile.source.contentHash,
    `0x${createHash("sha256")
      .update(
        JSON.stringify({
          id: profile.id,
          username: profile.username,
          description: profile.description,
        }),
      )
      .digest("hex")}`,
  );
});

test("public lookup works without any credential and does not fall back after blocked pages", async (t) => {
  environment(t, { X_SOURCE_MODE: undefined, X_API_BEARER_TOKEN: undefined });
  assert.equal(
    (
      await lookupXProfile(
        "ChogNFT",
        async () => new Response(page(currentProfile())),
      )
    )?.id,
    "1234",
  );
  let calls = 0;
  await assert.rejects(
    lookupXProfile("ChogNFT", async () => {
      calls++;
      return new Response("<html>Log in</html>");
    }),
    code("x_public_profile_unreadable"),
  );
  assert.equal(calls, 1);
  assert.equal(
    await lookupXProfile(
      "missing",
      async () => new Response("missing", { status: 404 }),
    ),
    null,
  );
});

test("X source modes are explicit and disabled or invalid modes make no request", async (t) => {
  environment(t, { X_SOURCE_MODE: "disabled", X_API_BEARER_TOKEN: undefined });
  const noRequest: typeof fetch = async () => {
    assert.fail("disabled sources cannot fetch");
  };
  await assert.rejects(
    lookupXProfile("ChogNFT", noRequest),
    code("x_source_disabled"),
  );
  process.env.X_SOURCE_MODE = "typo";
  await assert.rejects(
    lookupXProfile("ChogNFT", noRequest),
    code("x_source_configuration_invalid"),
  );
  process.env.X_SOURCE_MODE = "api";
  await assert.rejects(
    lookupXProfile("ChogNFT", noRequest),
    code("x_api_unconfigured"),
  );
  process.env.X_API_BEARER_TOKEN = "explicit-api-key";
  const profile = await lookupXProfile("ChogNFT", async (url, init) => {
    assert.equal(new URL(String(url)).hostname, "api.x.com");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer explicit-api-key",
    );
    return response(200, {
      data: { id: "1234", username: "ChogNFT", description: "bio" },
    });
  });
  assert.equal(profile?.source.method, "official_x_profile_snapshot");
  assert.match(profile!.source.contentHash, /^0x[0-9a-f]{64}$/);
});

test("partial hydration, unrelated profiles and nested bio codes cannot replace the exact profile", () => {
  const partial = {
    __typename: "User",
    id: "opaque",
    profile_user_originals_timeline: { instructions: [] },
  };
  const html =
    page(currentProfile()) +
    page(partial) +
    page({
      ...currentProfile(),
      rest_id: "999",
      core: { screen_name: "other" },
    });
  assert.equal(parseXProfile(html, "chognft").id, "1234");
  const profile = currentProfile() as any;
  profile.profile_bio.description = "";
  profile.recommended_user = {
    ...currentProfile(),
    profile_bio: { description: "Bio verification CHOG-ABC123" },
  };
  assert.equal(parseXProfile(page(profile), "ChogNFT").description, "");
});

test("profile parsing rejects numeric-ID coercion, conflicting aliases and oversized bios", () => {
  for (const mutate of [
    (profile: any) => {
      profile.rest_id = 1234;
    },
    (profile: any) => {
      profile.rest_id = "01";
    },
    (profile: any) => {
      profile.rest_id = "not-numeric";
    },
    (profile: any) => {
      profile.core.screen_name = 1234;
    },
    (profile: any) => {
      profile.legacy = { id_str: "999", screen_name: "ChogNFT" };
    },
    (profile: any) => {
      profile.legacy = { screen_name: "other" };
    },
    (profile: any) => {
      profile.legacy = { description: "Different bio" };
    },
    (profile: any) => {
      profile.profile_bio.description = ["CHOG-ABC123"];
    },
    (profile: any) => {
      profile.profile_bio.description = "x".repeat(2049);
    },
    (profile: any) => {
      profile.__typename = "UserUnavailable";
    },
  ]) {
    const profile = currentProfile();
    mutate(profile);
    assert.throws(
      () => parseXProfile(page(profile), "ChogNFT"),
      code("x_public_profile_unreadable"),
    );
  }
  assert.throws(
    () =>
      parseXProfile(
        page(currentProfile()) +
          page({ ...currentProfile(), rest_id: "invalid" }),
        "ChogNFT",
      ),
    code("x_public_profile_unreadable"),
  );
});

test("profile username and API redirect validation reject malformed sources before exposure", async () => {
  for (const username of [
    "../admin",
    "name?redirect=evil",
    "user@evil.invalid",
    "space name",
    "a".repeat(16),
    "",
  ]) {
    const noRequest: typeof fetch = async () => {
      assert.fail("invalid usernames cannot fetch");
    };
    await assert.rejects(
      lookupPublicXProfile(username, "token", noRequest),
      code("valid_x_username_required"),
    );
  }
  const redirect = response(200, {
    data: { id: "1234", username: "ChogNFT", description: "bio" },
  });
  Object.defineProperty(redirect, "url", { value: "https://api.x.com/login" });
  await assert.rejects(
    lookupPublicXProfile("ChogNFT", "token", async () => redirect),
    code("evidence_provider_redirect_rejected"),
  );
  await assert.rejects(
    lookupPublicXProfile(
      "ChogNFT",
      "token",
      async () => new Response("x".repeat(192 * 1024 + 1)),
    ),
    code("evidence_source_too_large"),
  );
});
