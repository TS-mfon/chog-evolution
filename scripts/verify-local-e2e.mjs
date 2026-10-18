import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["run", "test", "--workspace=@chog/api"], {
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  "LOCAL API WORKFLOW PASSED (repository contract tests; MongoDB runtime requires configured MONGODB_URI)",
);
