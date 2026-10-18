import { strict as assert } from "node:assert";
import { test } from "node:test";
import { artDataUri, composeDemoChog } from "../src/index.js";

test("composition is stable for the same demo identity and stage", () => {
  const first = composeDemoChog("42", "explorer");
  const second = composeDemoChog("42", "explorer");
  assert.deepEqual(first, second);
  assert.match(first.svg, /Original Chogins demo character, Explorer stage/);
  assert.equal(first.traits[0]?.value, "Chogins Demo");
});

test("higher stages unlock distinct deterministic traits", () => {
  const hatchling = composeDemoChog("7", "hatchling");
  const explorer = composeDemoChog("7", "explorer");
  const legend = composeDemoChog("7", "legend");
  assert.equal(hatchling.traits.find((trait) => trait.name === "Accessory")?.value, "None");
  assert.equal(explorer.traits.find((trait) => trait.name === "Accessory")?.value, "Trail scarf");
  assert.equal(legend.traits.find((trait) => trait.name === "Aura")?.value, "Comet glow");
  assert.notEqual(hatchling.svg, explorer.svg);
  assert.notEqual(explorer.svg, legend.svg);
});

test("invalid identities are rejected and data URI is renderable SVG", () => {
  assert.throws(() => composeDemoChog("01", "hatchling"), TypeError);
  assert.match(artDataUri("1", "hatchling"), /^data:image\/svg\+xml;charset=utf-8,/);
});
