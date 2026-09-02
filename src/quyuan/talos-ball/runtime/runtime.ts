import "./vendor/talos-ball-runtime/rings.js";
import "./vendor/talos-ball-runtime/emotions.js";
import "./vendor/talos-ball-runtime/ball.js";
import "./vendor/talos-ball-runtime/engine.js";

import type {
  TalosBallDefinition,
  TalosBallEngine,
  TalosBallEngineOptions,
  TalosBallRuntimeNamespace,
} from "./talos-ball-runtime-types";

export const TALOS_BALL_RUNTIME_SOURCE = Object.freeze({
  attribution: "src/vendor/talos-ball-runtime/SOURCE_ATTRIBUTION.md",
  sourceCommit: "b406eeb20a1b1ae0084d4006e77cc74e28be009d",
  engineVersion: "1.0.0",
  adoptedAt: "2026-08-30",
  sha256: Object.freeze({
    "ball.js": "14118ffa914e80dc04b44c50c57b3becd3ed666918fce975bd967637d86270a9",
    "emotions.js": "1233d771a308c4b3ddd67c157e9140e82dc1dc3c17a08aa82dcb6e44b091996d",
    "engine.js": "6fac52ac1f6c9b504b41f1ff7f0ae6519c5bae31e2581ea1c8c97e33eb62ad69",
    "rings.js": "eb538cebd60c2ad79237be9624bebc8dfab4e6b7185ed896356e56c948ef8f97",
  }),
});

export const TALOS_BALL_COMPATIBILITY_DEFAULTS = Object.freeze({
  emotion: "02",
  shape: "blob",
  idle: true,
  autostart: true,
  lite: false,
}) satisfies Readonly<TalosBallEngineOptions>;

export function getTalosBallRuntimeNamespace(): TalosBallRuntimeNamespace {
  const runtime = window.TalosBallRuntime;
  if (!runtime?.create || !runtime.config) {
    throw new Error("TalosBall runtime is unavailable");
  }
  return runtime;
}

export function createTalosBallRuntime(
  host: HTMLElement,
  options: TalosBallEngineOptions = {}
): TalosBallEngine {
  return getTalosBallRuntimeNamespace().create(host, {
    ...TALOS_BALL_COMPATIBILITY_DEFAULTS,
    ...options,
  });
}

export function listTalosBallDefinitions(group?: string): TalosBallDefinition[] {
  return getTalosBallRuntimeNamespace().config.list(group);
}
