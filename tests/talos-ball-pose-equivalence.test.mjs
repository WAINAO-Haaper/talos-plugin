import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { createPoseManifest } from "./helpers/talos-ball-pose-equivalence.mjs";

const vendorRoot = new URL("../src/quyuan/talos-ball/runtime/vendor/talos-ball-runtime/", import.meta.url);
const expected = JSON.parse(
  await readFile(
    new URL("./fixtures/talos-ball-pose-manifest.json", import.meta.url),
    "utf8"
  )
);

test("all 32 deterministic pose traces match the pinned upstream baseline", async () => {
  const actual = await createPoseManifest(vendorRoot.pathname);
  assert.deepEqual(actual, expected);
});
