import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test, type TestContext } from "node:test";
import { ApiError, type ClientFactory } from "../src/config.js";
import {
  metadataUrl,
  publicAddress,
  readOriginalMetadata,
  readPublicMetadataJson,
  MAX_ORIGINAL_METADATA_BYTES,
  type MetadataNetwork,
} from "../src/original-metadata.js";

const code = (expected: string) => (error: unknown) =>
  error instanceof ApiError && error.code === expected;
const cid = "Qm" + "a".repeat(44);
const tokenUri = "https://metadata.example.net/1.json";
const imageUri = "https://images.example.net/1.png";
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

test("metadata network policy excludes local, private, documentation and translated addresses", () => {
  for (const address of [
    "0.0.0.0",
    "0.9.8.7",
    "10.0.0.1",
    "100.64.0.1",
    "100.127.255.255",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.5",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "2001:db8::1",
    "2001:0db8:0000:0000:0000:0000:0000:0001",
    "2001::1",
    "2001:20::1",
    "2002:0a00:0001::1",
    "3fff::1",
    "8.8.8.8.invalid",
    "999.1.1.1",
    "0x7f000001",
    "2130706433",
    "localhost",
    "",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "100.63.255.255",
    "100.128.0.1",
    "172.15.0.1",
    "172.32.0.1",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
  ])
    assert.equal(publicAddress(address), true, address);
});

test("metadata URLs permit public HTTPS, IPFS and Arweave without resolving arbitrary schemes", () => {
  assert.equal(metadataUrl(tokenUri).href, tokenUri);
  assert.equal(
    metadataUrl(`ipfs://${cid}/1.json`).href,
    `https://ipfs.io/ipfs/${cid}/1.json`,
  );
  assert.equal(
    metadataUrl(`ipfs://ipfs/${cid}/1.json`).href,
    `https://ipfs.io/ipfs/${cid}/1.json`,
  );
  assert.equal(
    metadataUrl(`ar://${"a".repeat(43)}/1.json`).href,
    `https://arweave.net/${"a".repeat(43)}/1.json`,
  );
  for (const value of [
    "http://metadata.example.net/1.json",
    "file:///etc/passwd",
    "data:application/json,{}",
    "javascript:alert(1)",
    "https://user:pass@metadata.example.net/1.json",
    "https://metadata.example.net:443/1.json",
    "https://metadata.example.net:8443/1.json",
    "https://127.0.0.1/1.json",
    "https://2130706433/1.json",
    "https://0x7f000001/1.json",
    "https://0177.0.0.1/1.json",
    "https://[::1]/1.json",
    "https://[::ffff:127.0.0.1]/1.json",
    "https://localhost/1.json",
    "https://secret.internal/1.json",
    "https://metadata.example.net./1.json",
    "https://metadata.example.net/1.json#secret",
    "https://metadata.example.net/a/../1.json",
    "https://metadata.example.net/a/.%2e/1.json",
    "https://metadata.example.net/a/%2e./1.json",
    "https://metadata.example.net/%2fprivate",
    "https://metadata.example.net/a\\b",
    " https://metadata.example.net/1.json",
    "https://metadata.example.net/1.json\n",
    "ipfs://127.0.0.1/1.json",
    `ipfs://${cid}/../private`,
    "ar://small",
    "https://metadata.example.net/" + "x".repeat(2048),
  ])
    assert.throws(
      () => metadataUrl(value),
      code("original_metadata_url_not_allowed"),
      value,
    );
});

type TransportOptions = {
  payload?: unknown;
  raw?: string | Buffer;
  chunks?: Buffer[];
  status?: number;
  headers?: Record<string, string>;
  incomplete?: boolean;
  requestError?: boolean;
  timeout?: boolean;
  onRequest?: (url: URL, options: any) => void;
  resolve?: MetadataNetwork["resolve"];
};
function transport(options: TransportOptions = {}) {
  const state = {
    connections: 0,
    dns: [] as string[],
    destroyed: 0,
    requests: [] as { url: URL; options: any }[],
  };
  const network: MetadataNetwork = {
    resolve: async (hostname) => {
      state.dns.push(hostname);
      return options.resolve
        ? options.resolve(hostname)
        : [{ address: "1.1.1.1", family: 4 }];
    },
    request: ((url: URL, settings: any, callback: (response: any) => void) => {
      state.connections++;
      state.requests.push({ url, options: settings });
      options.onRequest?.(url, settings);
      const req = new EventEmitter() as any;
      let res: any;
      req.destroy = () => {
        state.destroyed++;
        res?.destroy();
        return req;
      };
      req.end = () => {
        queueMicrotask(() => {
          if (options.requestError) {
            req.emit("error", new Error("connection failed"));
            return;
          }
          if (options.timeout) {
            req.emit("timeout");
            return;
          }
          res = new PassThrough();
          res.statusCode = options.status ?? 200;
          res.headers = options.headers ?? {};
          res.complete = false;
          callback(res);
          if (res.destroyed) return;
          const chunks = options.chunks ?? [
            Buffer.from(
              options.raw ??
                JSON.stringify(
                  options.payload ?? { name: "Original Chog", image: imageUri },
                ),
            ),
          ];
          for (const chunk of chunks) {
            if (res.destroyed) break;
            res.write(chunk);
          }
          if (options.incomplete) {
            res.destroy();
            return;
          }
          if (!res.destroyed) {
            res.complete = true;
            res.end();
          }
        });
        return req;
      };
      return req;
    }) as MetadataNetwork["request"],
  };
  return { network, state };
}

test("metadata GET pins a vetted DNS address while preserving the TLS hostname", async () => {
  const f = transport({
    onRequest(url, options) {
      assert.equal(url.hostname, "metadata.example.net");
      assert.equal(options.method, "GET");
      assert.equal(options.agent, false);
      assert.equal(options.headers.authorization, undefined);
      assert.equal(options.headers.cookie, undefined);
      let one: any, all: any;
      options.lookup(
        url.hostname,
        {},
        (error: any, address: string, family: number) => {
          assert.equal(error, null);
          one = { address, family };
        },
      );
      options.lookup(
        url.hostname,
        { all: true },
        (error: any, addresses: any) => {
          assert.equal(error, null);
          all = addresses;
        },
      );
      assert.deepEqual(one, { address: "1.1.1.1", family: 4 });
      assert.deepEqual(all, [one]);
    },
  });
  assert.deepEqual(await readPublicMetadataJson(new URL(tokenUri), f.network), {
    name: "Original Chog",
    image: imageUri,
  });
  assert.deepEqual(f.state.dns, ["metadata.example.net"]);
  assert.equal(f.state.connections, 1);
});

test("mixed, private, empty or malformed DNS answers prevent every outbound connection", async () => {
  for (const addresses of [
    [],
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "::1", family: 6 }],
    [
      { address: "1.1.1.1", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ],
    [
      { address: "2001:4860:4860::8888", family: 6 },
      { address: "fe80::1", family: 6 },
    ],
    [{ address: "1.1.1.1", family: 6 }],
  ]) {
    const f = transport({ resolve: async () => addresses });
    await assert.rejects(
      readPublicMetadataJson(new URL(tokenUri), f.network),
      code("original_metadata_url_not_allowed"),
    );
    assert.equal(f.state.connections, 0);
  }
  const failed = transport({
    resolve: async () => {
      throw new Error("DNS unavailable");
    },
  });
  await assert.rejects(
    readPublicMetadataJson(new URL(tokenUri), failed.network),
    code("original_metadata_unavailable"),
  );
  assert.equal(failed.state.connections, 0);
});

test("metadata fetch never follows HTTP redirects or connects twice after DNS changes", async () => {
  const f = transport({
    status: 302,
    headers: { location: "http://169.254.169.254/latest/meta-data/" },
    resolve: async () => [{ address: "1.1.1.1", family: 4 }],
  });
  await assert.rejects(
    readPublicMetadataJson(new URL(tokenUri), f.network),
    code("original_metadata_unavailable"),
  );
  assert.equal(f.state.connections, 1);
  assert.equal(f.state.dns.length, 1);
  assert.equal(f.state.destroyed, 1);
  const noDns = transport();
  await assert.rejects(
    readPublicMetadataJson(new URL("https://127.0.0.1/private"), noDns.network),
    code("original_metadata_url_not_allowed"),
  );
  assert.equal(noDns.state.connections, 0);
  assert.equal(noDns.state.dns.length, 0);
});

test("metadata byte bounds apply to streamed bodies with or without content length", async () => {
  const cases = [
    {
      raw: "small",
      headers: { "content-length": String(MAX_ORIGINAL_METADATA_BYTES + 1) },
    },
    { chunks: [Buffer.alloc(65536), Buffer.alloc(65536), Buffer.alloc(1)] },
    {
      raw: Buffer.alloc(MAX_ORIGINAL_METADATA_BYTES + 1),
      headers: { "content-length": "1" },
    },
  ];
  for (const options of cases) {
    const f = transport(options);
    await assert.rejects(
      readPublicMetadataJson(new URL(tokenUri), f.network),
      code("original_metadata_too_large"),
    );
    assert.ok(f.state.destroyed > 0);
  }
  const exact = transport({
    raw: JSON.stringify({
      value: "x".repeat(MAX_ORIGINAL_METADATA_BYTES - 12),
    }),
  });
  const parsed = (await readPublicMetadataJson(
    new URL(tokenUri),
    exact.network,
  )) as any;
  assert.equal(parsed.value.length, MAX_ORIGINAL_METADATA_BYTES - 12);
});

test("incomplete, timed-out, compressed, malformed and error responses fail explicitly", async () => {
  for (const options of [
    { incomplete: true },
    { timeout: true },
    { requestError: true },
    { status: 403 },
    { status: 404 },
    { status: 503 },
  ]) {
    const f = transport(options);
    await assert.rejects(
      readPublicMetadataJson(new URL(tokenUri), f.network),
      code("original_metadata_unavailable"),
    );
  }
  for (const options of [
    { raw: "not-json" },
    { raw: "" },
    { headers: { "content-encoding": "gzip" } },
  ]) {
    const f = transport(options);
    await assert.rejects(
      readPublicMetadataJson(new URL(tokenUri), f.network),
      code("original_metadata_invalid"),
    );
  }
});

function originalFixture(
  t: TestContext,
  uri: unknown = tokenUri,
  chainId = 143,
) {
  environment(t, {
    ORIGINAL_CHOG_COLLECTION_ADDRESS: "0x" + "2".repeat(40),
    MONAD_MAINNET_CHAIN_ID: "143",
  });
  const calls: any[] = [];
  const factory = (() => ({
    getChainId: async () => chainId,
    readContract: async (input: any) => {
      calls.push(input);
      return uri;
    },
    writeContract: async () => {
      assert.fail("original NFT contracts must never be mutated");
    },
    sendTransaction: async () => {
      assert.fail("original metadata must never broadcast transactions");
    },
  })) as unknown as ClientFactory;
  return { calls, factory };
}

test("original NFT metadata performs only chain validation and tokenURI view calls", async (t) => {
  const fixture = originalFixture(t, `ipfs://${cid}/1.json`);
  const f = transport({
    payload: {
      name: "Original Chog",
      description: "Original collection identity",
      image: `ipfs://${cid}/1.png`,
      animation_url: "file:///ignored",
    },
  });
  const metadata = await readOriginalMetadata("1", fixture.factory, f.network);
  assert.equal(metadata.tokenUri, `ipfs://${cid}/1.json`);
  assert.equal(metadata.imageUrl, `https://ipfs.io/ipfs/${cid}/1.png`);
  assert.equal(metadata.name, "Original Chog");
  assert.equal(metadata.description, "Original collection identity");
  assert.ok(Number.isFinite(Date.parse(metadata.fetchedAt)));
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].functionName, "tokenURI");
  assert.deepEqual(fixture.calls[0].args, [1n]);
  assert.equal(fixture.calls[0].abi[0].stateMutability, "view");
  assert.equal(f.state.connections, 1);
  assert.deepEqual(f.state.dns, ["ipfs.io", "ipfs.io"]);
});

test("invalid token identifiers and chain mismatch prevent metadata fetching", async (t) => {
  const fixture = originalFixture(t);
  const f = transport();
  for (const token of [
    "-1",
    "1.5",
    "01",
    "0x1",
    "",
    "1".repeat(79),
    (2n ** 256n).toString(),
  ])
    await assert.rejects(
      readOriginalMetadata(token, fixture.factory, f.network),
      code("original_token_id_invalid"),
    );
  assert.equal(fixture.calls.length, 0);
  assert.equal(f.state.connections, 0);
  const wrong = originalFixture(t, tokenUri, 10143);
  await assert.rejects(
    readOriginalMetadata("1", wrong.factory, f.network),
    code("rpc_chain_mismatch"),
  );
  assert.equal(wrong.calls.length, 0);
  assert.equal(f.state.connections, 0);
});

test("original metadata rejects unsafe returned image URLs and does not fetch image bytes", async (t) => {
  const fixture = originalFixture(t);
  for (const image of [
    "https://127.0.0.1/private.png",
    "data:image/svg+xml,<svg/>",
    "javascript:alert(1)",
  ]) {
    const f = transport({ payload: { name: "Original", image } });
    await assert.rejects(
      readOriginalMetadata("1", fixture.factory, f.network),
      code("original_metadata_url_not_allowed"),
    );
    assert.equal(f.state.connections, 1);
  }
  const privateImage = transport({
    payload: { image: imageUri },
    resolve: async (hostname) => [
      {
        address: hostname === "images.example.net" ? "10.0.0.1" : "1.1.1.1",
        family: 4,
      },
    ],
  });
  await assert.rejects(
    readOriginalMetadata("1", fixture.factory, privateImage.network),
    code("original_metadata_url_not_allowed"),
  );
  assert.equal(privateImage.state.connections, 1);
});

test("metadata fields are bounded and unrelated JSON properties never mutate application prototypes", async (t) => {
  const fixture = originalFixture(t);
  const f = transport({
    raw: JSON.stringify({
      name: "N".repeat(200),
      description: "D".repeat(3000),
    }).replace("{", '{"__proto__":{"chogMetadataPolluted":true},'),
  });
  const metadata = await readOriginalMetadata("1", fixture.factory, f.network);
  assert.equal(metadata.name?.length, 120);
  assert.equal(metadata.description?.length, 2000);
  assert.equal(metadata.imageUrl, undefined);
  assert.equal(({} as any).chogMetadataPolluted, undefined);
  for (const raw of ["null", "[]", '"metadata"', "42", '{"image":{}}']) {
    await assert.rejects(
      readOriginalMetadata("1", fixture.factory, transport({ raw }).network),
      code("original_metadata_invalid"),
    );
  }
});
