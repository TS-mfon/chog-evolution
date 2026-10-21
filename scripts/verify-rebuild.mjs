import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const buildOnly = process.argv.includes("--build-only");
if (process.argv.slice(2).some((arg) => arg !== "--build-only"))
  throw new Error(
    "Unknown option. Use --build-only for build/static checks without browser acceptance.",
  );
const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.status}`,
    );
};
run("npm", ["run", "build"]);
const routes = [
  "/",
  "/mint",
  "/evolution",
  "/quests",
  "/activity",
  "/profile",
  "/upgrade",
];
const manifest = JSON.parse(
  await readFile(
    resolve(root, "apps/web/.next/server/app-paths-manifest.json"),
    "utf8",
  ),
);
const banned =
  /Original Chog token ID|Monad testnet mint transaction|Local simulated judge|LOCAL SIMULATION DISABLED|DEVELOPER WALKTHROUGH/i;
assert.ok(
  banned.test("Original Chog token ID"),
  "absence checker positive control",
);
for (const route of routes) {
  assert.ok(
    manifest[`${route === "/" ? "" : route}/page`],
    `missing production route ${route}`,
  );
  const path = resolve(
    root,
    "apps/web/.next/server/app",
    route === "/" ? "index.html" : route.slice(1) + ".html",
  );
  const html = await readFile(path, "utf8");
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
  assert.ok(/id="main-content"/.test(html), `${route} main landmark`);
  assert.ok(/<h1\b/.test(html), `${route} page heading`);
  assert.equal(
    banned.test(visible),
    false,
    `${route} removed technical/simulation copy`,
  );
}
const css = await readFile(resolve(root, "apps/web/app/styles.css"), "utf8");
assert.ok(css.includes("prefers-reduced-motion"), "reduced motion support");
assert.ok(css.includes(":focus-visible"), "visible keyboard focus");
const registry = JSON.parse(
  await readFile(resolve(root, "apps/web/components.json"), "utf8"),
);
assert.equal(
  registry.registries["@react-bits"],
  "https://reactbits.dev/r/{name}.json",
);
await access(resolve(root, "apps/web/public/brand/chog-hero.webp"));
console.log(
  "REBUILD BUILD VERIFIED (seven prerendered routes, public copy, accessibility CSS and registry configuration)",
);
if (!buildOnly) {
  run(process.execPath, [resolve(root, "scripts/verify-browser.mjs")]);
  console.log("REBUILD VERIFIED");
}
