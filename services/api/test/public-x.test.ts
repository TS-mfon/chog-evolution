import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { test, type TestContext } from "node:test";
import { GridFSBucket, type Db } from "mongodb";
import sharp from "sharp";
import { ApiError } from "../src/config.js";
import {
  boundedSource,
  parseXPost,
  parseXProfile,
  readPublicXPost,
  xRecords,
  X_PARSER_VERSION,
} from "../src/public-x.js";
import {
  captureContribution,
  evidenceDigest,
  parseContributionUrl,
  type SourceSnapshot,
} from "../src/evidence-source.js";
import {
  captureSourceMedia,
  readSourceMedia,
  sourceImageUrl,
  validateSourceImage,
  MAX_SOURCE_IMAGE_BYTES,
  MAX_SOURCE_MEDIA_BYTES,
} from "../src/media-capture.js";
import { MemoryDb } from "./memory-db.js";

const user = (id = "55", username = "chogger") => ({
  __typename: "User",
  rest_id: id,
  core: { screen_name: username },
  profile_bio: { description: "Public bio CHOG-12345" },
});
const post = (id = "123", authorId = "55") => ({
  __typename: "Tweet",
  rest_id: id,
  core: { user_results: { rest_id: authorId, result: user(authorId) } },
  details: {
    full_text: "An original Chog guide",
    created_at_ms: Date.parse("2026-10-20T10:00:00Z"),
  },
  media_entities2: [
    {
      type: "photo",
      media_url_https: "https://pbs.twimg.com/media/source.png",
    },
  ],
});
const jsonScript = (value: unknown) =>
  `<script type="application/json">${JSON.stringify(value)}</script>`;
const hydration = (value: unknown) =>
  `<script>window.cache.push({key:"data",value:${JSON.stringify(JSON.stringify(value))}})</script>`;
const postPage = (value: any = post()) =>
  hydration({ data: { tweet_result_by_rest_id: { result: value } } });
const profilePage = (value: any = user()) =>
  hydration({ data: { user_result_by_screen_name: { result: value } } });
const code = (expected: string) => (error: unknown) =>
  error instanceof ApiError && error.code === expected;
function environment(
  t: TestContext,
  values: Record<string, string | undefined>,
) {
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (before === undefined) delete process.env[key];
      else process.env[key] = before;
    });
  }
}

test("current public profile/post hydration binds the exact author and source image", () => {
  assert.deepEqual(parseXProfile(profilePage(), "CHOGGER"), {
    id: "55",
    username: "chogger",
    description: "Public bio CHOG-12345",
  });
  const parsed = parseXPost(postPage(), "123");
  assert.equal(parsed.author_id, "55");
  assert.equal(parsed.id, "123");
  assert.equal(parsed.text, "An original Chog guide");
  assert.equal(parsed.created_at, "2026-10-20T10:00:00.000Z");
  assert.deepEqual(parsed.media, [
    {
      sourceUrl: "https://pbs.twimg.com/media/source.png",
      type: "photo",
      postId: "123",
    },
  ]);
});

test("legacy GraphQL records, long posts, and visibility wrappers retain exact identity", () => {
  const legacyUser = {
    __typename: "User",
    rest_id: "55",
    legacy: { id_str: "55", screen_name: "chogger", description: "Legacy bio" },
  };
  assert.equal(
    parseXProfile(
      jsonScript({ data: { user: { result: legacyUser } } }),
      "chogger",
    ).description,
    "Legacy bio",
  );
  const legacy = {
    __typename: "Tweet",
    rest_id: "123",
    core: { user_results: { result: legacyUser } },
    legacy: {
      id_str: "123",
      user_id_str: "55",
      full_text: "truncated",
      created_at: "Tue Oct 20 10:00:00 +0000 2026",
      extended_entities: {
        media: [
          {
            type: "photo",
            media_url_https: "https://pbs.twimg.com/media/legacy.jpg",
            source_status_id_str: "123",
          },
        ],
      },
    },
    note_tweet: {
      note_tweet_results: {
        result: { text: "Complete long-form contribution" },
      },
    },
  };
  const parsed = parseXPost(
    jsonScript({
      data: {
        tweetResult: {
          result: { __typename: "TweetWithVisibilityResults", tweet: legacy },
        },
      },
    }),
    "123",
  );
  assert.equal(parsed.text, "Complete long-form contribution");
  assert.equal(parsed.author_id, "55");
  assert.equal(parsed.media[0]?.postId, "123");
  assert.equal(parsed.created_at, "2026-10-20T10:00:00.000Z");
});

test("hydration strings cannot smuggle verification records through text or comments", () => {
  const value = { data: { tweet_result_by_rest_id: { result: post() } } };
  const property = `value:${JSON.stringify(JSON.stringify(value))}`;
  const attacks = [
    property,
    `<script>const userText = ${JSON.stringify(`{${property}}`)};</script>`,
    `<script>// {${property}}\n/* {${property}} */</script>`,
    `<script>const example = \`{${property}}\`</script>`,
    `<script>const regex = /${property}/;</script>`,
    jsonScript({ text: property, recommendation: value }),
  ];
  for (const html of attacks)
    assert.throws(
      () => parseXPost(html, "123"),
      code("x_public_post_unreadable"),
    );
  assert.equal(xRecords(hydration(value)).length, 1);
  const malicious = `<script>globalThis.chogParserExecuted = true; window.cache.push({value:${JSON.stringify(JSON.stringify(value))}});</script>`;
  assert.equal(parseXPost(malicious, "123").id, "123");
  assert.equal((globalThis as any).chogParserExecuted, undefined);
});

test("large whitespace and repeated unclosed script tags stay bounded", () => {
  assert.deepEqual(xRecords(`<script>${" ".repeat(128 * 1024)}</script>`), []);
  assert.deepEqual(xRecords("<script>".repeat(16 * 1024)), []);
  assert.equal(
    parseXPost(`<script>${" ".repeat(128 * 1024)}</script>` + postPage(), "123")
      .id,
    "123",
  );
});

test("recommendations, quote tweets and nested matching posts cannot supply root identity", () => {
  const unrelated = post("999", "88") as any;
  unrelated.quoted_status_result = { result: post() };
  unrelated.recommendations = {
    data: { tweet_result_by_rest_id: { result: post() } },
  };
  assert.throws(
    () => parseXPost(postPage(unrelated), "123"),
    code("x_public_post_unreadable"),
  );
  assert.throws(
    () =>
      parseXPost(
        jsonScript({
          data: {
            threaded_conversation_with_injections_v2: {
              instructions: [{ tweet_results: { result: post() } }],
            },
          },
        }),
        "123",
      ),
    code("x_public_post_unreadable"),
  );
  const exact = post() as any;
  exact.media_entities2 = [];
  exact.quoted_status_result = { result: post("999", "88") };
  assert.deepEqual(parseXPost(postPage(exact), "123").media, []);
  assert.throws(
    () =>
      parseXProfile(
        jsonScript({
          data: {
            recommendations: { user_result_by_screen_name: { result: user() } },
          },
        }),
        "chogger",
      ),
    code("x_public_profile_unreadable"),
  );
});

test("ambiguous post/profile snapshots and conflicting numeric identity fields fail closed", () => {
  assert.throws(
    () => parseXProfile(profilePage() + profilePage(user("66")), "chogger"),
    code("x_public_profile_unreadable"),
  );
  assert.throws(
    () => parseXPost(postPage() + postPage(post("123", "66")), "123"),
    code("x_public_post_unreadable"),
  );
  assert.equal(parseXPost(postPage() + postPage(), "123").author_id, "55");
  for (const mutate of [
    (value: any) => {
      value.core.user_results.rest_id = "66";
    },
    (value: any) => {
      value.core.user_results.rest_id = 55;
    },
    (value: any) => {
      value.core.user_results.result.rest_id = "not-numeric";
    },
    (value: any) => {
      value.legacy = { user_id_str: "66" };
    },
    (value: any) => {
      value.core.user_results.result.legacy = { screen_name: "someone_else" };
    },
    (value: any) => {
      value.core.user_results.result.__typename = "UserUnavailable";
    },
    (value: any) => {
      value.details.created_at_ms = Number.MAX_VALUE;
    },
    (value: any) => {
      value.details.full_text = "x".repeat(10_001);
    },
    (value: any) => {
      value.media_entities2 = {};
    },
  ]) {
    const value = post();
    mutate(value);
    assert.throws(
      () => parseXPost(postPage(value), "123"),
      code("x_public_post_unreadable"),
    );
  }
  assert.throws(
    () => parseXPost(postPage({ ...post(), rest_id: "999" }), "123"),
    code("x_public_post_unreadable"),
  );
  assert.throws(
    () => parseXPost(postPage({ ...post(), legacy: { id_str: "999" } }), "123"),
    code("x_public_post_unreadable"),
  );
});

test("blocked/login pages and unsupported provider shapes remain explicit unavailable errors", () => {
  for (const html of [
    "<html>Log in to X</html>",
    "<h1>Access denied</h1>",
    jsonScript({
      data: { user: { result: { __typename: "UserUnavailable" } } },
    }),
    "<script type='application/json'>{</script>",
  ]) {
    assert.throws(
      () => parseXProfile(html, "chogger"),
      code("x_public_profile_unreadable"),
    );
    assert.throws(
      () => parseXPost(html, "123"),
      code("x_public_post_unreadable"),
    );
  }
  assert.throws(
    () => xRecords("a".repeat(2 * 1024 * 1024 + 1)),
    code("evidence_source_too_large"),
  );
});

test("only direct source photos enter capture; typed images work and borrowed media stays unbound", () => {
  const value = post() as any;
  value.media_entities2 = [
    {
      media_info: {
        __typename: "ApiImage",
        original_img_url: "https://pbs.twimg.com/media/new.webp",
      },
    },
    {
      type: "photo",
      media_url_https: "https://pbs.twimg.com/media/borrowed.png",
      source_status_id_str: "999",
    },
    {
      type: "video",
      media_url_https: "https://pbs.twimg.com/media/thumbnail.jpg",
    },
    { media_url_https: "https://pbs.twimg.com/media/untyped.png" },
    { type: "photo", media_url_https: "https://pbs.twimg.com/media/fifth.jpg" },
  ];
  const media = parseXPost(postPage(value), "123").media;
  assert.equal(media.length, 4);
  assert.equal(media[0]?.type, "photo");
  assert.equal(media[0]?.sourceUrl, "https://pbs.twimg.com/media/new.webp");
  assert.equal(media[1]?.postId, "999");
  assert.equal(media[1]?.errorCode, "source_image_post_mismatch");
  assert.equal(media[2]?.type, "video");
  assert.equal(media[3]?.type, "unsupported");
});

test("anonymous contribution capture uses stable account identity across handle changes", async (t) => {
  environment(t, {
    X_SOURCE_MODE: "public_page",
    X_API_BEARER_TOKEN: "leftover-key",
  });
  const source = parseContributionUrl(
    "https://twitter.com/CHOGGER/status/123?s=20",
  );
  const request: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://x.com/chogger/status/123");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return new Response(postPage());
  };
  const captured = await captureContribution(
    source,
    "0x" + "a".repeat(40),
    { provider_user_id: "55", username: "previous_handle" },
    request,
  );
  assert.equal(captured.identity_binding.provider_user_id, "55");
  assert.equal(captured.public_content.parser_version, X_PARSER_VERSION);
  assert.equal(
    captured.content_hash,
    evidenceDigest(JSON.stringify(captured.public_content)),
  );
  await assert.rejects(
    captureContribution(source, "wallet", null, request),
    code("x_profile_link_required"),
  );
  await assert.rejects(
    captureContribution(
      source,
      "wallet",
      { provider_user_id: "66", username: "chogger" },
      request,
    ),
    code("evidence_author_not_linked_to_wallet"),
  );
  await assert.rejects(
    readPublicXPost("wrong", "123", async () => new Response(postPage())),
    code("x_public_post_author_mismatch"),
  );
});

test("explicit API capture binds only the post's attachment keys, never recommendation media", async (t) => {
  environment(t, { X_SOURCE_MODE: "api", X_API_BEARER_TOKEN: "fixture-key" });
  const snapshot = await captureContribution(
    parseContributionUrl("https://x.com/chogger/status/123"),
    "wallet",
    { provider_user_id: "55", username: "chogger" },
    async (_url, init) => {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer fixture-key",
      );
      return Response.json({
        data: {
          id: "123",
          text: "Original",
          author_id: "55",
          attachments: { media_keys: ["3_1"] },
        },
        includes: {
          users: [{ id: "55", username: "chogger" }],
          media: [
            {
              media_key: "3_2",
              type: "photo",
              url: "https://pbs.twimg.com/media/unrelated.png",
            },
            {
              media_key: "3_1",
              type: "photo",
              url: "https://pbs.twimg.com/media/bound.png",
            },
          ],
        },
      });
    },
  );
  assert.deepEqual(snapshot.media, [
    {
      sourceUrl: "https://pbs.twimg.com/media/bound.png",
      type: "photo",
      postId: "123",
    },
  ]);
});

test("submitted evidence URLs reject SSRF, credentials, ports, dot segments and lookalike hosts", () => {
  for (const value of [
    "http://x.com/u/status/123",
    "https://x.com:443/u/status/123",
    "https://x.com:444/u/status/123",
    "https://x.com@127.0.0.1/u/status/123",
    "https://x.com.evil.invalid/u/status/123",
    "https://127.0.0.1/u/status/123",
    "https://[::1]/u/status/123",
    "https://x.com./u/status/123",
    "https://%78.com/u/status/123",
    "https://x.com/u/status/123#fragment",
    "https://x.com/u/status/000123",
    "https://x.com/u/status/123/extra",
    "https://x.com/u/../u/status/123",
    "https://x.com/u/.%2e/u/status/123",
    "https://x.com/u/%2e./u/status/123",
    "https://x.com/u\\status/123",
    " https://x.com/u/status/123",
    "https://x.com/u/status/123\n",
    "https://github.com/owner/../repo",
    "https://github.com/owner/repo/issues/1",
    "https://github.com:443/owner/repo",
  ])
    assert.throws(() => parseContributionUrl(value), ApiError, value);
  assert.equal(
    parseContributionUrl(
      "https://www.github.com/Owner/Project.git?ref=anything",
    ).canonicalUrl,
    "https://github.com/owner/project",
  );
  assert.equal(
    parseContributionUrl("https://www.twitter.com/U/status/123").canonicalUrl,
    "https://x.com/u/status/123",
  );
});

test("bounded public reads reject redirects, HTTP failures, empty bodies and oversized streams", async () => {
  const url = new URL("https://x.com/chogger");
  await assert.rejects(
    boundedSource(url, async () => {
      throw new TypeError("network");
    }),
    code("evidence_source_unavailable"),
  );
  for (const [status, expected] of [
    [404, "evidence_source_not_found"],
    [410, "evidence_source_not_found"],
    [429, "evidence_provider_rate_limited"],
    [403, "evidence_source_unavailable"],
    [503, "evidence_source_unavailable"],
  ] as const)
    await assert.rejects(
      boundedSource(url, async () => new Response("failed", { status })),
      code(expected),
    );
  const redirected = new Response("data");
  Object.defineProperty(redirected, "url", { value: "https://x.com/login" });
  await assert.rejects(
    boundedSource(url, async () => redirected),
    code("evidence_provider_redirect_rejected"),
  );
  await assert.rejects(
    boundedSource(url, async () => new Response(null)),
    code("evidence_source_empty"),
  );
  await assert.rejects(
    boundedSource(url, async () => new Response("")),
    code("evidence_source_empty"),
  );
  await assert.rejects(
    boundedSource(
      url,
      async () =>
        new Response("small", { headers: { "content-length": "100" } }),
      5,
    ),
    code("evidence_source_too_large"),
  );
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(6));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    boundedSource(url, async () => new Response(stream), 5),
    code("evidence_source_too_large"),
  );
  assert.equal(cancelled, true);
  assert.equal(
    (await boundedSource(url, async () => new Response("12345"), 5)).toString(),
    "12345",
  );
});

test("public X post reads follow one username case correction and retain author identity", async () => {
  const urls: string[] = [];
  const result = await readPublicXPost("CHOGGER", "123", async (url, init) => {
    urls.push(String(url));
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    if (urls.length === 1)
      return new Response(null, {
        status: 307,
        headers: { location: "/chogger/status/123" },
      });
    return new Response(postPage());
  });
  assert.deepEqual(urls, [
    "https://x.com/CHOGGER/status/123",
    "https://x.com/chogger/status/123",
  ]);
  assert.equal(result.id, "123");
  assert.equal(result.author_id, "55");
  assert.equal(result.username, "chogger");
});

test("X case correction rejects other hosts, credentials, paths, posts, queries and redirect chains before fetching", async () => {
  for (const location of [
    "https://evil.invalid/chogger/status/123",
    "https://x.com.evil.invalid/chogger/status/123",
    "https://user@x.com/chogger/status/123",
    "http://x.com/chogger/status/123",
    "/login",
    "/other/status/123",
    "/chogger/status/124",
    "/chogger/status/123?next=evil",
    "/chogger/status/123#fragment",
    "/CHOGGER/status/123",
    "https://x.com:444/chogger/status/123",
  ]) {
    let calls = 0;
    await assert.rejects(
      readPublicXPost("CHOGGER", "123", async () => {
        calls++;
        return new Response(null, { status: 307, headers: { location } });
      }),
      code("evidence_provider_redirect_rejected"),
    );
    assert.equal(calls, 1, location);
  }
  let calls = 0;
  await assert.rejects(
    readPublicXPost("CHOGGER", "123", async () => {
      calls++;
      return new Response(null, {
        status: 307,
        headers: {
          location: calls === 1 ? "/chogger/status/123" : "/CHOGGER/status/123",
        },
      });
    }),
    code("evidence_provider_redirect_rejected"),
  );
  assert.equal(calls, 2);
});

const makeImage = (
  format: "png" | "jpeg" | "webp" = "png",
  width = 3,
  height = 2,
) =>
  sharp({ create: { width, height, channels: 3, background: "#aaccff" } })
    .toFormat(format)
    .toBuffer();
const sourceSnapshot = (
  media: NonNullable<SourceSnapshot["media"]>,
): SourceSnapshot => ({
  provider: "x",
  source_id: "123",
  canonical_url: "https://x.com/chogger/status/123",
  fetched_at: new Date().toISOString(),
  content_hash: "0x" + "a".repeat(64),
  public_content: { id: "123" },
  identity_binding: {
    verified: true,
    method: "public_x_provider_identity",
    provider_user_id: "55",
  },
  media,
});
const photo = (name = "photo") => ({
  sourceUrl: `https://pbs.twimg.com/media/${name}.png`,
  type: "photo",
  postId: "123",
});

test("JPEG, PNG and WebP validation decodes pixels and records original byte hashes", async () => {
  for (const format of ["png", "jpeg", "webp"] as const) {
    const raw = await makeImage(format);
    const info = await validateSourceImage(raw);
    assert.equal(info.mimeType, `image/${format}`);
    assert.equal(info.width, 3);
    assert.equal(info.height, 2);
    assert.equal(info.bytes, raw.length);
    assert.equal(info.sha256, createHash("sha256").update(raw).digest("hex"));
  }
});

test("image validation rejects truncation, deceptive formats, animation and decompression bombs", async () => {
  const png = await makeImage();
  const frames = Buffer.from([
    ...Array(4).fill([255, 0, 0]).flat(),
    ...Array(4).fill([0, 0, 255]).flat(),
  ]);
  const animated = await sharp(frames, {
    raw: { width: 2, height: 4, pageHeight: 2, channels: 3 },
  })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  const corruptPixels = Buffer.from(png);
  corruptPixels[corruptPixels.indexOf(Buffer.from("IDAT")) + 4] ^= 0xff;
  assert.equal((await sharp(corruptPixels).metadata()).format, "png");
  for (const raw of [
    Buffer.alloc(0),
    Buffer.from("<html>Log in</html>"),
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>',
    ),
    png.subarray(0, 45),
    png.subarray(0, png.length - 15),
    corruptPixels,
    animated,
  ])
    await assert.rejects(
      validateSourceImage(raw),
      code("source_image_invalid"),
    );
  await assert.rejects(
    validateSourceImage(Buffer.alloc(MAX_SOURCE_IMAGE_BYTES + 1)),
    code("source_image_too_large"),
  );
  const tooManyPixels = await makeImage("png", 4001, 4000);
  await assert.rejects(
    validateSourceImage(tooManyPixels),
    code("source_image_invalid"),
  );
  assert.equal(
    (await validateSourceImage(await makeImage("png", 4000, 4000))).width,
    4000,
  );
});

test("source image URL policy rejects unrelated posts, unsupported media and CDN escapes", () => {
  const snapshot = sourceSnapshot([]);
  for (const value of [
    "http://pbs.twimg.com/media/a.png",
    "https://pbs.twimg.com:443/media/a.png",
    "https://pbs.twimg.com@evil.invalid/media/a.png",
    "https://pbs.twimg.com.evil.invalid/media/a.png",
    "https://127.0.0.1/media/a.png",
    "https://[::1]/media/a.png",
    "https://pbs.twimg.com/profile_images/a.png",
    "https://pbs.twimg.com/media/../media/a.png",
    "https://pbs.twimg.com/media/.%2e/media/a.png",
    "https://pbs.twimg.com/media/a.svg",
    "https://pbs.twimg.com/media/a.gif",
    "https://pbs.twimg.com/media/a.png#x",
    "https://pbs.twimg.com/media/a?redirect=https://evil.invalid",
    "https://pbs.twimg.com/media/a?format=png&format=jpeg",
    "https://pbs.twimg.com/media/a?format=svg",
    "https://pbs.twimg.com/media/a?name=../private",
    "https://pbs.twimg.com/media/a.png\n",
  ])
    assert.throws(
      () => sourceImageUrl({ ...photo(), sourceUrl: value }, snapshot),
      code("source_image_not_allowed"),
      value,
    );
  assert.throws(
    () => sourceImageUrl({ ...photo(), postId: "999" }, snapshot),
    code("source_image_post_mismatch"),
  );
  assert.throws(
    () => sourceImageUrl({ ...photo(), type: "video" }, snapshot),
    code("source_image_unsupported"),
  );
  assert.throws(
    () => sourceImageUrl(photo(), { ...snapshot, provider: "github" }),
    code("source_image_not_allowed"),
  );
  assert.equal(
    sourceImageUrl(
      {
        ...photo(),
        sourceUrl: "https://pbs.twimg.com/media/a?name=orig&format=png",
      },
      snapshot,
    ).href,
    "https://pbs.twimg.com/media/a?format=png&name=orig",
  );
});

async function gridfsFixture(t: TestContext) {
  const memory = new MemoryDb();
  await memory
    .collection("source_media")
    .createIndex({ job_id: 1, source_url: 1 }, { unique: true });
  const files = new Map<string, any>();
  const chunks = new Map<string, Buffer>();
  const state = {
    uploads: 0,
    failedUploads: 0,
    failUploadOnce: false,
    failCheckpointOnce: false,
    cleaned: [] as string[],
  };
  const database = {
    client: memory.client,
    collection(name: string) {
      if (name === "chog_source_media.files")
        return {
          async findOne(query: any) {
            return files.get(String(query._id)) ?? null;
          },
        };
      if (name === "chog_source_media.chunks")
        return {
          async deleteMany(query: any) {
            state.cleaned.push(String(query.files_id));
            chunks.delete(String(query.files_id));
            return { deletedCount: 1 };
          },
        };
      const collection = memory.collection(name);
      if (name !== "source_media") return collection;
      return {
        ...collection,
        async updateOne(query: any, update: any, options?: any) {
          if (state.failCheckpointOnce && update.$set?.status === "captured") {
            state.failCheckpointOnce = false;
            throw new Error("checkpoint connection dropped after upload");
          }
          return collection.updateOne(query, update, options);
        },
      };
    },
  } as unknown as Db;
  t.mock.method(
    GridFSBucket.prototype,
    "openUploadStreamWithId",
    function (id: any, filename: string, options: any) {
      state.uploads++;
      const stream = new Writable({
        write(raw, _encoding, callback) {
          chunks.set(String(id), Buffer.from(raw));
          callback();
        },
        final(callback) {
          if (state.failUploadOnce) {
            state.failUploadOnce = false;
            state.failedUploads++;
            callback(new Error("upload connection dropped"));
            return;
          }
          files.set(String(id), {
            _id: id,
            filename,
            length: chunks.get(String(id))!.length,
            metadata: options.metadata,
          });
          callback();
        },
      });
      return Object.assign(stream, { id });
    },
  );
  t.mock.method(
    GridFSBucket.prototype,
    "openDownloadStream",
    function (id: any) {
      return Readable.from([chunks.get(String(id))!]);
    },
  );
  return { database, memory, files, chunks, state };
}

test("capture checkpoints four exact source images and a retry reuses immutable GridFS bytes", async (t) => {
  const f = await gridfsFixture(t);
  const raw = await makeImage();
  const snapshot = sourceSnapshot([
    photo("a"),
    photo("b"),
    photo("c"),
    photo("d"),
    photo("ignored"),
  ]);
  let fetches = 0;
  const request: typeof fetch = async (_url, init) => {
    fetches++;
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return new Response(raw);
  };
  const first = await captureSourceMedia(
    f.database,
    snapshot,
    request,
    "four-image-job",
  );
  assert.equal(first.length, 4);
  assert.equal(fetches, 4);
  assert.equal(f.state.uploads, 4);
  assert.ok(
    first.every(
      (item) => item.status === "captured" && item.mediaId && item.sha256,
    ),
  );
  assert.deepEqual(
    await captureSourceMedia(f.database, snapshot, request, "four-image-job"),
    first,
  );
  assert.equal(fetches, 4);
  assert.equal(f.state.uploads, 4);
  assert.equal(f.files.size, 4);
  const stored = await readSourceMedia(f.database, first[0]!.mediaId!);
  assert.ok(stored);
  const bytes: Buffer[] = [];
  for await (const chunk of stored.stream) bytes.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(bytes), raw);
  assert.equal(await readSourceMedia(f.database, "not-an-id"), null);
});

test("duplicate source URLs share a single media checkpoint and untrusted captured fields are discarded", async (t) => {
  const f = await gridfsFixture(t);
  const raw = await makeImage();
  let fetches = 0;
  const snapshot = sourceSnapshot([
    {
      ...photo(),
      mediaId: "someone-elses-image",
      status: "captured",
      sha256: "invented",
    },
    photo(),
  ]);
  const media = await captureSourceMedia(
    f.database,
    snapshot,
    async () => {
      fetches++;
      return new Response(raw);
    },
    "duplicate-job",
  );
  assert.equal(fetches, 1);
  assert.equal(f.state.uploads, 1);
  assert.equal(media[0]?.mediaId, media[1]?.mediaId);
  assert.notEqual(media[0]?.mediaId, "someone-elses-image");
  assert.notEqual(media[0]?.sha256, "invented");
});

test("unsupported or unrelated images are never fetched and failures remain retryable checkpoints", async (t) => {
  const f = await gridfsFixture(t);
  const raw = await makeImage();
  let fetches = 0;
  const snapshot = sourceSnapshot([
    photo("valid"),
    { ...photo("video"), type: "video" },
    { ...photo("borrowed"), postId: "999" },
  ]);
  const first = await captureSourceMedia(
    f.database,
    snapshot,
    async () => {
      fetches++;
      throw new Error("temporary");
    },
    "failure-job",
  );
  assert.equal(fetches, 1);
  assert.equal(first[0]?.errorCode, "evidence_source_unavailable");
  assert.equal(first[1]?.errorCode, "source_image_unsupported");
  assert.equal(first[2]?.errorCode, "source_image_post_mismatch");
  assert.equal(f.memory.rows("source_media")[0].status, "unavailable");
  const second = await captureSourceMedia(
    f.database,
    snapshot,
    async () => {
      fetches++;
      return new Response(raw);
    },
    "failure-job",
  );
  assert.equal(second[0]?.status, "captured");
  assert.equal(fetches, 2);
  assert.equal(f.state.uploads, 1);
});

test("completed uploads recover after a failed checkpoint write without a second fetch or upload", async (t) => {
  const f = await gridfsFixture(t);
  const raw = await makeImage();
  let fetches = 0;
  f.state.failCheckpointOnce = true;
  const request: typeof fetch = async () => {
    fetches++;
    return new Response(raw);
  };
  assert.equal(
    (
      await captureSourceMedia(
        f.database,
        sourceSnapshot([photo()]),
        request,
        "recover-checkpoint",
      )
    )[0]?.status,
    "unavailable",
  );
  assert.equal(f.files.size, 1);
  const retry = await captureSourceMedia(
    f.database,
    sourceSnapshot([photo()]),
    request,
    "recover-checkpoint",
  );
  assert.equal(retry[0]?.status, "captured");
  assert.equal(fetches, 1);
  assert.equal(f.state.uploads, 1);
});

test("interrupted uploads remove orphan chunks and preserve the media identity on retry", async (t) => {
  const f = await gridfsFixture(t);
  const raw = await makeImage();
  f.state.failUploadOnce = true;
  const first = await captureSourceMedia(
    f.database,
    sourceSnapshot([photo()]),
    async () => new Response(raw),
    "partial-upload",
  );
  const checkpoint = f.memory.rows("source_media")[0];
  const id = checkpoint._id;
  const orphan = checkpoint.gridfs_id;
  assert.equal(first[0]?.status, "unavailable");
  assert.equal(f.files.size, 0);
  assert.equal(f.chunks.size, 1);
  const second = await captureSourceMedia(
    f.database,
    sourceSnapshot([photo()]),
    async () => new Response(raw),
    "partial-upload",
  );
  assert.equal(second[0]?.status, "captured");
  assert.equal(second[0]?.mediaId, id);
  assert.deepEqual(f.state.cleaned, [orphan]);
  assert.equal(f.files.size, 1);
  assert.equal(f.chunks.size, 1);
});

test("concurrent workers share a job lease and a changed source cannot reuse another checkpoint", async (t) => {
  const f = await gridfsFixture(t);
  const raw = await makeImage();
  let unblock!: () => void;
  const pause = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let fetched!: () => void;
  const started = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  const first = captureSourceMedia(
    f.database,
    sourceSnapshot([photo()]),
    async () => {
      fetched();
      await pause;
      return new Response(raw);
    },
    "concurrent-job",
  );
  await started;
  let additionalFetches = 0;
  const second = await captureSourceMedia(
    f.database,
    sourceSnapshot([photo()]),
    async () => {
      additionalFetches++;
      return new Response(raw);
    },
    "concurrent-job",
  );
  assert.equal(second[0]?.errorCode, "source_media_capture_in_progress");
  assert.equal(additionalFetches, 0);
  unblock();
  assert.equal((await first)[0]?.status, "captured");
  assert.equal(f.state.uploads, 1);
  const changed = sourceSnapshot([{ ...photo(), postId: "456" }]);
  changed.source_id = "456";
  assert.equal(
    (
      await captureSourceMedia(
        f.database,
        changed,
        async () => new Response(raw),
        "concurrent-job",
      )
    )[0]?.errorCode,
    "source_media_checkpoint_conflict",
  );
});

test("expired media job leases recover after process death", async (t) => {
  const f = await gridfsFixture(t);
  const raw = await makeImage();
  const snapshot = sourceSnapshot([photo()]);
  await captureSourceMedia(
    f.database,
    snapshot,
    async () => {
      throw new Error("offline");
    },
    "expired-job",
  );
  await f.memory.collection("source_media_jobs").updateOne(
    { _id: "expired-job" },
    {
      $set: {
        lease_token: "dead-process",
        lease_until: new Date(Date.now() - 1),
      },
    },
  );
  assert.equal(
    (
      await captureSourceMedia(
        f.database,
        snapshot,
        async () => new Response(raw),
        "expired-job",
      )
    )[0]?.status,
    "captured",
  );
});

test("aggregate download budget includes invalid bytes and stops further image requests", async (t) => {
  const f = await gridfsFixture(t);
  let fetches = 0;
  const media = await captureSourceMedia(
    f.database,
    sourceSnapshot([photo("a"), photo("b"), photo("c"), photo("d")]),
    async () => {
      fetches++;
      return new Response(Buffer.alloc(MAX_SOURCE_IMAGE_BYTES));
    },
    "byte-budget",
  );
  assert.equal(fetches, 2);
  assert.equal(MAX_SOURCE_MEDIA_BYTES, 2 * MAX_SOURCE_IMAGE_BYTES);
  assert.equal(media[0]?.errorCode, "source_image_invalid");
  assert.equal(media[1]?.errorCode, "source_image_invalid");
  assert.equal(media[2]?.errorCode, "source_media_budget_exceeded");
  assert.equal(media[3]?.errorCode, "source_media_budget_exceeded");
  assert.equal(f.state.uploads, 0);
});

test("retry budget includes completed later images before an earlier missing image", async (t) => {
  const f = await gridfsFixture(t);
  const image = await makeImage();
  const raw = Buffer.concat([
    image,
    Buffer.alloc(MAX_SOURCE_IMAGE_BYTES - image.length),
  ]);
  assert.equal((await validateSourceImage(raw)).bytes, MAX_SOURCE_IMAGE_BYTES);
  const snapshot = sourceSnapshot([photo("missing"), photo("b"), photo("c")]);
  let fetches = 0;
  const first = await captureSourceMedia(
    f.database,
    snapshot,
    async () => {
      fetches++;
      if (fetches === 1)
        throw new Error("first source temporarily unavailable");
      return new Response(raw);
    },
    "resume-budget",
  );
  assert.equal(first[0]?.status, "unavailable");
  assert.equal(first[1]?.status, "captured");
  assert.equal(first[2]?.status, "captured");
  assert.equal(first[1]!.bytes! + first[2]!.bytes!, MAX_SOURCE_MEDIA_BYTES);
  const retry = await captureSourceMedia(
    f.database,
    snapshot,
    async () => {
      fetches++;
      return new Response(raw);
    },
    "resume-budget",
  );
  assert.equal(fetches, 3);
  assert.equal(f.state.uploads, 2);
  assert.equal(retry[0]?.errorCode, "source_media_budget_exceeded");
  assert.equal(retry[1]?.mediaId, first[1]?.mediaId);
  assert.equal(retry[2]?.mediaId, first[2]?.mediaId);
});

test("a staged image cannot change its bytes while reusing a public media id", async (t) => {
  const f = await gridfsFixture(t);
  const original = await makeImage();
  f.state.failUploadOnce = true;
  const snapshot = sourceSnapshot([photo()]);
  await captureSourceMedia(
    f.database,
    snapshot,
    async () => new Response(original),
    "immutable-media",
  );
  const id = f.memory.rows("source_media")[0]._id;
  const sha = f.memory.rows("source_media")[0].sha256;
  const changed = await makeImage("png", 4, 4);
  const retry = await captureSourceMedia(
    f.database,
    snapshot,
    async () => new Response(changed),
    "immutable-media",
  );
  assert.equal(retry[0]?.errorCode, "source_image_changed");
  assert.equal(f.state.uploads, 1);
  assert.equal(f.memory.rows("source_media")[0].sha256, sha);
  const recovered = await captureSourceMedia(
    f.database,
    snapshot,
    async () => new Response(original),
    "immutable-media",
  );
  assert.equal(recovered[0]?.status, "captured");
  assert.equal(recovered[0]?.mediaId, id);
  assert.equal(recovered[0]?.sha256, sha);
});

test("a corrupt GridFS checkpoint never supplies unrelated stored bytes", async (t) => {
  const f = await gridfsFixture(t);
  const raw = await makeImage();
  const snapshot = sourceSnapshot([photo()]);
  const first = await captureSourceMedia(
    f.database,
    snapshot,
    async () => new Response(raw),
    "corrupt-checkpoint",
  );
  const file = [...f.files.values()][0];
  file.metadata.postId = "someone-elses-post";
  let fetches = 0;
  const retry = await captureSourceMedia(
    f.database,
    snapshot,
    async () => {
      fetches++;
      return new Response(raw);
    },
    "corrupt-checkpoint",
  );
  assert.equal(retry[0]?.errorCode, "source_media_checkpoint_invalid");
  assert.equal(fetches, 0);
  await assert.rejects(
    readSourceMedia(f.database, first[0]!.mediaId!),
    code("source_media_checkpoint_invalid"),
  );
});

test("repeated failing image references do not repeat network reads in one attempt", async (t) => {
  const f = await gridfsFixture(t);
  let fetches = 0;
  const result = await captureSourceMedia(
    f.database,
    sourceSnapshot([photo(), photo()]),
    async () => {
      fetches++;
      throw new Error("offline");
    },
    "same-failed-image",
  );
  assert.equal(fetches, 1);
  assert.ok(result.every((item) => item.status === "unavailable"));
});

test("per-image download limits, corrupt files and redirect responses never become captured assets", async (t) => {
  const f = await gridfsFixture(t);
  const oversized = await captureSourceMedia(
    f.database,
    sourceSnapshot([photo()]),
    async () =>
      new Response("small", {
        headers: { "content-length": String(MAX_SOURCE_IMAGE_BYTES + 1) },
      }),
    "large-image",
  );
  assert.equal(oversized[0]?.errorCode, "source_image_too_large");
  const redirected = new Response(await makeImage());
  Object.defineProperty(redirected, "url", {
    value: "https://127.0.0.1/private",
  });
  const redirect = await captureSourceMedia(
    f.database,
    sourceSnapshot([photo()]),
    async () => redirected,
    "redirected-image",
  );
  assert.equal(redirect[0]?.errorCode, "evidence_provider_redirect_rejected");
  assert.equal(f.state.uploads, 0);
});
