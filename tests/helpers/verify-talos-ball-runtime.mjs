import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const vendorRoot = new URL("../../src/quyuan/talos-ball/runtime/vendor/talos-ball-runtime/", import.meta.url);

export const EXPECTED_SHA256 = Object.freeze({
  "ball.js": "14118ffa914e80dc04b44c50c57b3becd3ed666918fce975bd967637d86270a9",
  "emotions.js": "1233d771a308c4b3ddd67c157e9140e82dc1dc3c17a08aa82dcb6e44b091996d",
  "engine.js": "6fac52ac1f6c9b504b41f1ff7f0ae6519c5bae31e2581ea1c8c97e33eb62ad69",
  "rings.js": "eb538cebd60c2ad79237be9624bebc8dfab4e6b7185ed896356e56c948ef8f97",
  LICENSE: "cd25a8e1b00d05b2bb29d3a626599526db960b5bf3ba94fd726565b9bec7f8ea",
  "LICENSE-COMMERCIAL.md":
    "0c9ce7fd2349fcda788702a5867d85546874e406dd42aeef0c944e53834d1d67",
  "NOTICE.md": "549d6607c9dd13c9add2fa5faeccca488bd78cf30cac2b0b4d3dbcd8b45b721d",
  "SOURCE_ATTRIBUTION.md": "26645c59ce53bcee9018a75aab7a27789f0b74b64fc0191620d737e339a3c5d2",
});

export async function verifyTalosBallRuntime() {
  const results = [];
  for (const [file, expected] of Object.entries(EXPECTED_SHA256)) {
    const bytes = await readFile(new URL(file, vendorRoot));
    const actual = createHash("sha256").update(bytes).digest("hex");
    results.push({ file, expected, actual, ok: actual === expected });
  }
  return results;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const results = await verifyTalosBallRuntime();
  for (const result of results) {
    console.log(`${result.ok ? "OK" : "FAIL"} ${result.file} ${result.actual}`);
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}
