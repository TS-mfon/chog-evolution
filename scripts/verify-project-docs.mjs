import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFile(resolve(root, file), "utf8");
const docs = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "contracts/README.md",
  "genlayer/README.md",
  "assets/chog-references/README.md",
  ...(await readdir(resolve(root, "docs")))
    .filter((file) => /\.md$/.test(file))
    .map((file) => `docs/${file}`),
];
const sources = [
  ".env.example",
  "package.json",
  "contracts/src/DemoChog.sol",
  "genlayer/ClaimAdjudicator.py",
  "packages/evolution-rules/src/index.ts",
  "services/api/src/index.ts",
  "services/api/src/product-routes.ts",
  "services/api/src/mongo.ts",
  "services/evolution-worker/src/genlayer.ts",
  "deployments/monad-testnet.json",
  "deployments/genlayer-studionet.json",
  ".github/workflows/deploy-vercel.yml",
  ".github/workflows/evolution-worker.yml",
];
const contents = Object.fromEntries(
  await Promise.all(
    [...new Set([...docs, ...sources])].map(async (file) => [
      file,
      await read(file),
    ]),
  ),
);
const failures = [];
const requireText = (file, value) => {
  if (!contents[file]?.includes(value))
    failures.push(`${file}: missing ${JSON.stringify(value)}`);
};

// Strip fenced examples before checking real Markdown links or heading anchors.
function prose(text) {
  let fence;
  return text
    .split("\n")
    .map((line) => {
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (match) {
        if (!fence) fence = match[1];
        else if (
          match[1][0] === fence[0] &&
          match[1].length >= fence.length &&
          !match[2].trim()
        )
          fence = undefined;
        return "";
      }
      return fence ? "" : line;
    })
    .join("\n");
}
function anchors(text) {
  const counts = new Map();
  const result = new Set();
  for (const match of prose(text).matchAll(
    /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/gm,
  )) {
    const slug = match[1]
      .replace(/<[^>]*>/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    result.add(count ? `${slug}-${count}` : slug);
  }
  return result;
}
async function linkFailure(owner, raw) {
  const target = raw.replace(/^<|>$/g, "").trim();
  if (/^(?:https?:|mailto:|data:|app:)/i.test(target)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return `${owner}: invalid link encoding ${target}`;
  }
  const [path, fragment] = decoded.split("#", 2);
  const full = path
    ? path.startsWith("/")
      ? resolve(root, path.slice(1))
      : resolve(root, dirname(owner), path)
    : resolve(root, owner);
  const name = relative(root, full);
  if (name.startsWith("../") || name === "..")
    return `${owner}: link escapes repository ${target}`;
  let info;
  try {
    info = await stat(full);
  } catch {
    return `${owner}: missing link target ${target}`;
  }
  if (fragment && info.isFile() && /\.md$/i.test(full)) {
    const text = contents[name] ?? (await readFile(full, "utf8"));
    if (!anchors(text).has(fragment))
      return `${owner}: missing heading anchor ${target}`;
  }
  return null;
}

// Known positive/negative controls exercise the same checker used on the docs.
assert.deepEqual(
  [...anchors("# Same\n# Same\n```text\n# Hidden\n```")],
  ["same", "same-1"],
);
assert.equal(await linkFailure("README.md", "docs/README.md"), null);
assert.match(
  await linkFailure("README.md", "docs/__chog_missing_link_control__.md"),
  /missing link target/,
);
assert.match(
  await linkFailure("README.md", "#__chog_missing_anchor_control__"),
  /missing heading anchor/,
);
assert.match(
  await linkFailure("README.md", "../__chog_escape_control__"),
  /escapes repository/,
);

let linkCount = 0;
for (const file of docs) {
  const text = prose(contents[file]);
  const targets = [
    ...[
      ...text.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g),
    ].map((match) => match[1]),
    ...[...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]),
  ];
  for (const target of targets) {
    linkCount++;
    const failure = await linkFailure(file, target);
    if (failure) failures.push(failure);
  }
}

function syntax(file) {
  return ts.createSourceFile(
    file,
    contents[file],
    ts.ScriptTarget.Latest,
    true,
  );
}
function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}
function literal(node) {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
    return literal(node.expression);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties
        .filter(ts.isPropertyAssignment)
        .map((p) => [
          p.name.getText().replace(/["']/g, ""),
          literal(p.initializer),
        ]),
    );
  return undefined;
}
function variable(file, name) {
  let result;
  visit(syntax(file), (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === name &&
      node.initializer
    )
      result = literal(node.initializer);
  });
  assert.notEqual(
    result,
    undefined,
    `${file}: source constant ${name} not found`,
  );
  return result;
}
function routes(file) {
  const result = new Set();
  visit(syntax(file), (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression)
    )
      return;
    const { expression, name } = node.expression;
    if (
      expression.getText() !== "app" ||
      !["get", "post", "patch", "put", "delete"].includes(name.text)
    )
      return;
    const path = node.arguments[0];
    if (!path || !ts.isStringLiteral(path) || path.text.startsWith("/v1/dev/"))
      return;
    result.add(`${name.text.toUpperCase()} ${path.text}`);
  });
  return result;
}
const implemented = new Set([
  ...routes("services/api/src/index.ts"),
  ...routes("services/api/src/product-routes.ts"),
]);
const documented = new Set(
  [
    ...contents["docs/API.md"].matchAll(
      /^\|\s*`(GET|POST|PATCH|PUT|DELETE) ([^`]+)`\s*\|/gm,
    ),
  ].map((m) => `${m[1]} ${m[2]}`),
);
assert(
  implemented.size > 30,
  "API parser must discover the maintained route inventory",
);
for (const route of implemented)
  if (!documented.has(route))
    failures.push(`docs/API.md: undocumented implemented route ${route}`);
for (const route of documented)
  if (!implemented.has(route))
    failures.push(`docs/API.md: nonexistent documented route ${route}`);

// Compare independently measured source constants with reference tables.
const ruleFile = "packages/evolution-rules/src/index.ts";
const progression = variable(ruleFile, "PROGRESSION_POLICY_VERSION");
const catalogue = variable(ruleFile, "TRAIT_CATALOGUE_VERSION");
const schema = variable("services/api/src/mongo.ts", "SCHEMA_VERSION");
requireText("README.md", `Current progression policy: **${progression}**`);
requireText("README.md", `Trait catalogue: **${catalogue}**`);
requireText("docs/protocol.md", `MongoDB schema \`${schema}\``);
for (const { stage, minXp } of variable(ruleFile, "STAGE_THRESHOLDS")) {
  const pattern = new RegExp(
    "\\|\\s*`?" + stage + "`?\\s*\\|\\s*" + minXp + "\\s*\\|",
    "i",
  );
  for (const file of ["README.md", "docs/protocol.md"])
    if (!pattern.test(contents[file]))
      failures.push(`${file}: stage threshold drift for ${stage}`);
}
for (const { slug, xp } of variable(
  "services/api/src/mongo.ts",
  "definitions",
)) {
  const line = contents["docs/quest-registry.md"]
    .split("\n")
    .find((row) => row.startsWith("|") && row.includes(slug));
  if (!line || !new RegExp(`\\b${xp} XP\\b`).test(line))
    failures.push(`docs/quest-registry.md: reward drift for ${slug}`);
}
const environment = Object.fromEntries(
  [...contents[".env.example"].matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)].map(
    (m) => [m[1], m[2].trim()],
  ),
);
for (const name of Object.keys(environment))
  requireText("docs/configuration.md", `\`${name}\``);
const demo = JSON.parse(contents["deployments/monad-testnet.json"]);
const genlayer = JSON.parse(contents["deployments/genlayer-studionet.json"]);
assert.equal(
  environment.DEMO_COLLECTION_ADDRESS.toLowerCase(),
  demo.contractAddress.toLowerCase(),
);
assert.equal(
  environment.GENLAYER_CONTRACT_ADDRESS.toLowerCase(),
  genlayer.contractAddress.toLowerCase(),
);
assert.equal(Number(environment.MONAD_TESTNET_CHAIN_ID), demo.chainId);
for (const file of ["README.md", "docs/deployment.md", "contracts/README.md"])
  requireText(file, demo.contractAddress);
for (const file of ["README.md", "docs/deployment.md", "genlayer/README.md"])
  requireText(file, genlayer.contractAddress);
for (const [file, expected] of [
  ["contracts/src/DemoChog.sol", demo.deploymentSourceSha256],
  ["genlayer/ClaimAdjudicator.py", genlayer.sourceSha256],
]) {
  if (createHash("sha256").update(contents[file]).digest("hex") !== expected)
    failures.push(
      `${file}: source differs from recorded deployment; document compatibility before claiming the recorded source`,
    );
}
requireText("docs/API.md", "active, recently checked quest policy");
requireText("README.md", "npm run db:migrate --workspace=@chog/api");
requireText("docs/react-bits.md", "config/codex-mcp.toml");
requireText("docs/integrations.md", "workflow_dispatch");
requireText(".github/workflows/evolution-worker.yml", 'cron: "*/5 * * * *"');
requireText(
  ".github/workflows/evolution-worker.yml",
  "cancel-in-progress: false",
);
requireText(
  ".github/workflows/evolution-worker.yml",
  "npm run once --workspace=@chog/worker",
);
requireText(".github/workflows/deploy-vercel.yml", "npm run test:browser:all");
requireText(".github/workflows/deploy-vercel.yml", "GITHUB_PUBLIC_READ_TOKEN");
requireText(
  "services/evolution-worker/src/genlayer.ts",
  "TransactionHashVariant.LATEST_FINAL",
);
requireText("docs/protocol.md", "LATEST_FINAL");

const ledgerIds = [
  ...contents["docs/implementation-checklist.md"].matchAll(
    /^\|\s*([A-Z]+-\d{3})\s*\|/gm,
  ),
].map((m) => m[1]);
if (new Set(ledgerIds).size !== ledgerIds.length || ledgerIds.length < 40)
  failures.push(
    "docs/implementation-checklist.md: incomplete or duplicate requirement IDs",
  );
for (const file of [
  "README.md",
  "docs/setup.md",
  "docs/deployment.md",
  ".env.example",
])
  if (
    /ENABLE_LOCAL_DEMO_SCENARIOS=true|NEXT_PUBLIC_ENABLE_LOCAL_SIMULATION=true/.test(
      contents[file],
    )
  )
    failures.push(
      `${file}: public setup must not instruct enabling fixture simulation`,
    );
const packageJson = JSON.parse(contents["package.json"]);
for (const name of [
  "dev",
  "build",
  "check",
  "test",
  "db:migrate",
  "metadata:check",
  "test:integration",
  "test:browser:all",
])
  assert(packageJson.scripts[name], `missing documented root script ${name}`);

const readmeLines = contents["README.md"].trimEnd().split("\n");
if (
  readmeLines.length < 500 ||
  readmeLines.filter((line) => line.trim()).length < 350
)
  failures.push(
    "README.md: requires at least 500 lines with substantive coverage",
  );
for (const section of [
  "Statement of the problem",
  "Design goals and acceptance criteria",
  "System architecture",
  "Protocol specification",
  "Contract interfaces and administrative powers",
  "HTTP API and client integration",
  "Operating and deploying the MVP",
  "Security assumptions and residual risks",
])
  requireText("README.md", `## ${section}`);
if ([...contents["README.md"].matchAll(/^```mermaid$/gm)].length < 3)
  failures.push("README.md: architecture and lifecycle diagrams are missing");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`README COVERAGE PASSED (${readmeLines.length} lines)`);
  console.log(
    `PROJECT DOCS PASSED (${docs.length} documents, ${implemented.size} maintained routes, ${linkCount} links; negative controls passed)`,
  );
}
