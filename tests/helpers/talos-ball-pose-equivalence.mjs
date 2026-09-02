import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const UPSTREAM_COMMIT =
  "b406eeb20a1b1ae0084d4006e77cc74e28be009d";
export const BASE_TIME_MS = 100_000;
export const RANDOM_SEED = 0x5a17c0de;
export const SAMPLE_OFFSETS_MS = Object.freeze([
  0, 70, 150, 300, 700, 1_400, 2_800, 5_600, 11_200,
]);
export const EMOTION_IDS = Object.freeze([
  "00", "01", "02", "03", "04", "05", "06", "07",
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21",
  "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function seededMath(seed) {
  let state = seed >>> 0;
  const math = Object.create(Math);
  Object.defineProperty(math, "random", {
    value: () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x1_0000_0000;
    },
  });
  return math;
}

function canonicalize(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    const rounded = Number(value.toFixed(9));
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  if (Array.isArray(value)) {
    return Array.from(value, canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

async function readRuntime(vendorRoot) {
  const files = {};
  for (const file of ["rings.js", "emotions.js", "engine.js"]) {
    files[file] = await readFile(path.join(vendorRoot, file), "utf8");
  }
  return files;
}

async function traceEmotion(vendorRoot, emotionId) {
  const runtime = await readRuntime(vendorRoot);
  let now = BASE_TIME_MS;
  let latestPose = null;
  const window = {
    TalosBallRuntime: {
      createBall: () => ({
        applyPose: (pose) => {
          latestPose = pose;
        },
        burst: () => undefined,
        destroy: () => undefined,
      }),
    },
  };
  const context = {
    window,
    TalosBallRuntime: window.TalosBallRuntime,
    document: { querySelector: () => null },
    performance: { now: () => now },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
    setInterval: () => 1,
    clearInterval: () => undefined,
    console: {
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    Math: seededMath(RANDOM_SEED ^ Number(emotionId)),
  };

  vm.createContext(context);
  for (const file of ["rings.js", "emotions.js", "engine.js"]) {
    vm.runInContext(runtime[file], context, { filename: file });
  }

  const engine = context.window.TalosBallRuntime.create(
    {},
    {
      emotion: emotionId,
      fallbackId: "02",
      idle: false,
      autostart: false,
      lite: true,
      shape: "blob",
    }
  );

  const frames = [];
  for (const offsetMs of SAMPLE_OFFSETS_MS) {
    now = BASE_TIME_MS + offsetMs;
    engine._tick(now);
    if (!latestPose) throw new Error("Engine did not emit a pose");
    frames.push({
      offsetMs,
      emotionId: engine.emotionId,
      pose: canonicalize(latestPose),
    });
  }
  engine.destroy();
  return frames;
}

export async function createPoseManifest(vendorRoot) {
  const states = {};
  for (const emotionId of EMOTION_IDS) {
    const trace = await traceEmotion(vendorRoot, emotionId);
    states[emotionId] = sha256(JSON.stringify(trace));
  }
  return {
    schemaVersion: 1,
    upstreamCommit: UPSTREAM_COMMIT,
    baseTimeMs: BASE_TIME_MS,
    randomSeed: RANDOM_SEED,
    sampleOffsetsMs: [...SAMPLE_OFFSETS_MS],
    stateCount: EMOTION_IDS.length,
    states,
    aggregateSha256: sha256(JSON.stringify(states)),
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (fileURLToPath(import.meta.url) === invokedPath) {
  const vendorRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : fileURLToPath(new URL("../src/vendor/talos-ball-runtime/", import.meta.url));
  console.log(JSON.stringify(await createPoseManifest(vendorRoot), null, 2));
}
