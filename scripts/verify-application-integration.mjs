import { spawnSync } from "node:child_process";

for (const args of [["run", "test", "--workspace=@chog/api"], ["run", "check", "--workspace=@chog/web"]]) {
  const result = spawnSync("npm", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("APPLICATION INTEGRATION PASSED (API route and web type checks)");
