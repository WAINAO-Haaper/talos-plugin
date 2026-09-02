import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const contract = JSON.parse(
  await readFile(new URL("../src/quyuan/talos-ball/runtime/state-contract.json", import.meta.url), "utf8")
);

test("TalosBall exposes the approved 12 semantic states", () => {
  assert.deepEqual(Object.keys(contract), [
    "idle",
    "listening",
    "receiving",
    "working",
    "thinking",
    "searching",
    "responding",
    "success",
    "warning",
    "error",
    "restricted",
    "stopped",
  ]);
});

test("semantic adapter points only to unchanged upstream definitions", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(contract).map(([state, definition]) => [
        state,
        definition.emotionId,
      ])
    ),
    {
      idle: "02",
      listening: "35",
      receiving: "31",
      working: "32",
      thinking: "30",
      searching: "40",
      responding: "39",
      success: "33",
      warning: "11",
      error: "34",
      restricted: "38",
      stopped: "41",
    }
  );
});
