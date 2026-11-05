import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../lib/studio-view.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { getChainHistory } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
const history = [
  { id: "a-new", chain_id: "a", output_text: "New A result" },
  { id: "b-new", chain_id: "b", output_text: "B result" },
  { id: "a-old", chain_id: "a", output_text: "Older A result" },
];
assert.deepEqual(getChainHistory(history, null, "a-new"), {
  runs: [],
  viewed: undefined,
});
console.log("PASS new drafts never display a previous chain’s generated media");
assert.deepEqual(
  getChainHistory(history, "b", "a-new").runs.map((r) => r.id),
  ["b-new"],
);
assert.equal(getChainHistory(history, "b", "a-new").viewed.id, "b-new");
console.log("PASS switching chains cannot display the previously selected run");
assert.equal(
  getChainHistory(history, "a", "a-old").viewed.output_text,
  "Older A result",
);
assert.equal(getChainHistory(history, "a", "missing").viewed.id, "a-new");
assert.equal(getChainHistory(history, "empty-chain", null).viewed, undefined);
console.log("PASS saved run selection, latest-run fallback, and empty chains");
