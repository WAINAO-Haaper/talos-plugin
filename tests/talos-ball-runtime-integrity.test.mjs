import assert from "node:assert/strict";
import { test } from "vitest";
import { verifyTalosBallRuntime } from "./helpers/verify-talos-ball-runtime.mjs";

test("TalosBall runtime, data and attribution match the locked local baseline", async () => {
  const results = await verifyTalosBallRuntime();
  assert.equal(results.length, 8);
  assert.deepEqual(
    results.filter((result) => !result.ok),
    []
  );
});
