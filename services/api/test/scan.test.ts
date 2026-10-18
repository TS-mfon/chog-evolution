import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseScanTargets, scanTargetKey } from "../src/scan-repository.js";

const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const target = { chainId: 143, address: "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763", topic0: transferTopic, walletTopicIndex: 2, startBlock: 100, name: "Chog Genesis transfers", explorerTxBase: "https://monadscan.com" };

test("parses chain-scoped scan configuration and stable checkpoint keys", () => {
  const [parsed] = parseScanTargets(JSON.stringify([target]));
  assert.ok(parsed);
  assert.equal(parsed.chainId, 143);
  assert.equal(scanTargetKey(parsed), `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763:${transferTopic}:2`);
});

test("empty configuration is explicit and invalid/duplicate targets fail closed", () => {
  assert.deepEqual(parseScanTargets(undefined), []);
  assert.deepEqual(parseScanTargets("[]"), []);
  assert.throws(() => parseScanTargets("not-json"), /JSON/);
  assert.throws(() => parseScanTargets(JSON.stringify([{ ...target, walletTopicIndex: 0 }])), /invalid_scan_targets/);
  assert.throws(() => parseScanTargets(JSON.stringify([target, target])), /duplicate_scan_target/);
});
