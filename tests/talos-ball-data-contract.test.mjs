import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import vm from "node:vm";

const vendorRoot = new URL("../src/quyuan/talos-ball/runtime/vendor/talos-ball-runtime/", import.meta.url);

async function loadData() {
  const context = { window: {} };
  vm.createContext(context);
  for (const file of ["rings.js", "emotions.js"]) {
    const source = await readFile(new URL(file, vendorRoot), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}

function asLocalValue(value) {
  return JSON.parse(JSON.stringify(value));
}

test("pinned geometry retains every upstream contour", async () => {
  const { EB_RINGS: rings } = await loadData();
  assert.equal(rings.HEAD_C, 114.2705);
  assert.equal(rings.EYE_HALF, 21);
  assert.equal(rings.STAR_GOLD, "#f4c34e");
  assert.equal(rings.EXPRESSIONS.length, 25);
  for (const [left, right] of rings.EXPRESSIONS) {
    assert.equal(left.length, 48);
    assert.equal(right.length, 48);
  }
  assert.deepEqual(asLocalValue(Object.keys(rings.SHAPES)), ["blob", "wedge", "gem"]);
  for (const shape of Object.values(rings.SHAPES)) {
    assert.equal(shape.ring.length, 96);
  }
});

test("pinned emotion data retains all 32 upstream definitions", async () => {
  const { EMOTION_SEED: emotions } = await loadData();
  assert.equal(emotions.length, 32);
  assert.deepEqual(
    asLocalValue(emotions.map((emotion) => emotion.id)),
    [
      "00", "01", "02", "03", "04", "05", "06", "07",
      "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21",
      "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41",
    ]
  );
  assert.deepEqual(
    Object.fromEntries(
      ["life", "emotion", "agent"].map((group) => [
        group,
        Array.from(emotions).filter((emotion) => emotion.group === group).length,
      ])
    ),
    { life: 8, emotion: 12, agent: 12 }
  );
  assert.equal(Array.from(emotions).filter((emotion) => emotion.sequence).length, 10);
});

test("v1 runtime has body and eye geometry but no mouth layer", async () => {
  const sources = await Promise.all(
    ["rings.js", "emotions.js", "ball.js", "engine.js"].map((file) =>
      readFile(new URL(file, vendorRoot), "utf8")
    )
  );
  assert.doesNotMatch(sources.join("\n"), /\bmouth\b/i);
});
