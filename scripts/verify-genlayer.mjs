import { readFile } from "node:fs/promises";

const source = await readFile("genlayer/ClaimAdjudicator.py", "utf8");
const required = [
  '"Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"',
  "gl.message.sender_address != self.owner",
  "gl.vm.run_nondet_unsafe(leader_fn, validator_fn)",
  "independently_fetched",
  '"source_unavailable"',
];
const missing = required.filter((part) => !source.includes(part));
if (missing.length) throw new Error(`GenLayer source checks failed: ${missing.join(", ")}`);
console.log("GENLAYER SOURCE PASSED");
