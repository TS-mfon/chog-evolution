import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
assert.equal(
  Number(process.versions.node.split(".")[0]),
  24,
  "MVP verification uses Node 24",
);
assert.equal(
  process.argv.length,
  2,
  "verify-mvp does not accept options that skip checks",
);
async function run(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "inherit",
  });
  const exit = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  assert.equal(exit.code, 0, `${command} ${args.join(" ")} failed`);
}
await run(process.execPath, ["scripts/verify-rebuild.mjs", "--build-only"]);
await run("npm", ["run", "check"]);
await run("forge", ["test", "--root", "contracts", "--offline"]);
await run("genvm-lint", ["check", "genlayer/ClaimAdjudicator.py"]);
await run(process.execPath, ["scripts/verify-genlayer.mjs"]);
await run(process.execPath, ["scripts/verify-project-docs.mjs"]);
const manifest = JSON.parse(
  await readFile(resolve(root, "assets/chog-references/manifest.json"), "utf8"),
);
assert.equal(
  manifest.upstreamRepository,
  "https://github.com/TS-mfon/chog-evolution",
);
assert.equal(
  manifest.upstreamCommit,
  "b1b273b58c37a09d96ff98de08a552df6623bd78",
);
assert.equal(manifest.references.length, 5);
for (const reference of manifest.references) {
  assert.match(reference.file, /^reference-0[1-5]\.png$/);
  const bytes = await readFile(
    resolve(root, "assets/chog-references", reference.file),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    reference.sha256,
    `reference content changed: ${reference.file}`,
  );
}
console.log(
  "MVP REGRESSIONS VERIFIED (production build, seven routes, workspace types, Solidity, GenVM, docs and five reference content pins)",
);
