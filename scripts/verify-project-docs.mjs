import { readFile } from "node:fs/promises";

const files = [
  "README.md",
  "docs/deployment.md",
  "docs/API.md",
  "docs/setup.md",
  "docs/integrations.md",
  "docs/testing.md",
  "docs/architecture.md",
  "docs/implementation-checklist.md",
  "docs/rebuild-release.md",
  "docs/react-bits.md",
  ".env.example",
  ".github/workflows/evolution-worker.yml",
  ".github/workflows/deploy-vercel.yml",
];
const contents = Object.fromEntries(
  await Promise.all(
    files.map(async (file) => [file, await readFile(file, "utf8")]),
  ),
);
const failures = [];
const requireText = (file, text) => {
  if (!contents[file].includes(text))
    failures.push(`${file}: missing ${JSON.stringify(text)}`);
};

requireText("README.md", "npm run dev");
requireText("README.md", "npm run db:migrate --workspace=@chog/api");
requireText("docs/deployment.md", "Finalized");
requireText(".env.example", "MONGODB_URI=");
requireText(".env.example", "PUBLIC_API_PATH=/api");
requireText(".env.example", "GITHUB_PUBLIC_READ_TOKEN=");
requireText(".env.example", "SCAN_WALLET_LOOKBACK_BLOCKS=");
requireText(".env.example", "MONAD_OWNER_PRIVATE_KEY=");
requireText(".env.example", "ORIGINAL_CHOG_COLLECTION_ADDRESS=");
requireText(".env.example", "GENLAYER_CONTRACT_ADDRESS=");
requireText("docs/API.md", "POST /v1/mints/confirm");
requireText("docs/API.md", "POST /v1/upgrades/evidence");
requireText("docs/API.md", "GET /v1/metadata/demo/:tokenId");
requireText("docs/react-bits.md", "config/codex-mcp.toml");
requireText(".github/workflows/deploy-vercel.yml", "npm run test:browser");
requireText(".github/workflows/deploy-vercel.yml", "GITHUB_PUBLIC_READ_TOKEN");
for (const file of [".env.example", "docs/setup.md", "docs/deployment.md"]) {
  if (
    /ENABLE_LOCAL_DEMO_SCENARIOS=true|NEXT_PUBLIC_ENABLE_LOCAL_SIMULATION=true/.test(
      contents[file],
    )
  ) {
    failures.push(
      `${file}: setup must not instruct users to enable simulation`,
    );
  }
}
requireText("docs/integrations.md", "workflow_dispatch");
requireText("docs/integrations.md", "MONGODB_URI");
requireText("docs/implementation-checklist.md", "Requirement / source");
requireText(".github/workflows/evolution-worker.yml", 'cron: "*/5 * * * *"');
requireText(
  ".github/workflows/evolution-worker.yml",
  "cancel-in-progress: false",
);
requireText(
  ".github/workflows/evolution-worker.yml",
  "npm run once --workspace=@chog/worker",
);
const ledgerIds = [
  ...contents["docs/implementation-checklist.md"].matchAll(
    /^\|\s*([A-Z]+-\d{3})\s*\|/gm,
  ),
].map((match) => match[1]);
if (new Set(ledgerIds).size !== ledgerIds.length)
  failures.push(
    "docs/implementation-checklist.md: requirement IDs must be unique",
  );
if (ledgerIds.length < 40)
  failures.push(
    "docs/implementation-checklist.md: expected detailed requirement ledger",
  );
if (
  contents["docs/API.md"].includes("POST /v1/claims") &&
  !contents["docs/API.md"].includes("active, recently checked quest policy")
) {
  failures.push(
    "docs/API.md: claims must be documented as gated on an active, recently checked quest policy",
  );
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log("PROJECT DOCS PASSED");
