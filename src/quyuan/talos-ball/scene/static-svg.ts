import { generateValveEyes } from "../expression/valve-eye";
import {
  generateCrownKeelPath,
  generateOrbitPath
} from "../form/crown-keel";
import { STATE_DESCRIPTIONS } from "../semantics/descriptions";
import { STATE_VECTORS } from "../semantics/state-vectors";
import type {
  OrbState,
  StaticOrbOptions
} from "../semantics/types";
import { resolveTheme, themeCssVariables } from "../surface/tokens";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeId(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "-");
  return sanitized || "talos-orb";
}

function n(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export function renderStaticSvg(options: StaticOrbOptions = {}): string {
  const state = options.state ?? "idle";
  const vector = STATE_VECTORS[state];
  const theme = resolveTheme(options.theme);
  const id = safeId(options.idPrefix ?? `talos-orb-${state}`);
  const title = options.title ?? STATE_DESCRIPTIONS[state].label;
  const size = Math.max(48, Math.min(512, options.size ?? 160));
  const bodyPath = generateCrownKeelPath(vector);
  const eyes = generateValveEyes(vector, { x: 0, y: 0 });
  const orbitPath = generateOrbitPath();
  const bodyGradient = `${id}-body-gradient`;
  const titleId = `${id}-title`;
  const blueOpacity = vector.blueAura * 0.34;
  const yellowOpacity = vector.yellowAura * 0.36;
  const transform = `rotate(${n(vector.lean)} 50 49)`;

  return [
    `<svg data-talos-orb="" data-state="${state}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-labelledby="${titleId}" style="${themeCssVariables(theme)}">`,
    `<title id="${titleId}">${escapeXml(title)}</title>`,
    "<defs>",
    `<radialGradient id="${bodyGradient}" cx="36%" cy="28%" r="76%">`,
    `<stop data-part="gradient-surface-top" offset="0" stop-color="${theme.surface}"/>`,
    `<stop data-part="gradient-surface-base" offset=".66" stop-color="${theme.surface}"/>`,
    `<stop data-part="gradient-edge-blue" offset=".88" stop-color="${theme.cloudBlue}"/>`,
    `<stop data-part="gradient-edge-ink" offset="1" stop-color="${theme.ink}"/>`,
    "</radialGradient>",
    "</defs>",
    `<ellipse data-part="shadow" cx="50" cy="89.1" rx="25.8" ry="3.2" fill="${theme.ink}" opacity=".12"/>`,
    `<circle data-part="blue-aura" cx="50" cy="49" r="${n(42.4 + vector.blueAura * 1.8)}" fill="none" stroke="${theme.cloudBlue}" stroke-width="1.4" opacity="${n(blueOpacity)}"/>`,
    `<circle data-part="yellow-aura" cx="50" cy="49" r="${n(41.7 + vector.yellowAura * 1.2)}" fill="none" stroke="${theme.signalYellow}" stroke-width="1.6" opacity="${n(yellowOpacity)}"/>`,
    `<path data-part="orbit" d="${orbitPath}" fill="none" stroke="${theme.cloudBlue}" stroke-width="1.8" stroke-linecap="round" opacity="${n(vector.orbit * 0.78)}"/>`,
    `<g data-part="body-group" transform="${transform}">`,
    `<path data-part="body" d="${bodyPath}" fill="${theme.surface}" stroke="${theme.ink}" stroke-opacity=".075" stroke-width=".72"/>`,
    `<path data-part="body-glaze" d="${bodyPath}" fill="url(#${bodyGradient})" opacity=".19"/>`,
    `<ellipse data-part="core" cx="50" cy="53" rx="${n(13.5 + vector.core * 2)}" ry="${n(10.5 + vector.core * 1.4)}" fill="${theme.signalYellow}" opacity="${n(vector.core * 0.2)}"/>`,
    `<path data-part="sheen" d="M 27.7 31.2 C 35.4 18.7 52.6 14.7 64.6 21.5" fill="none" stroke="${theme.surface}" stroke-width="2.2" stroke-linecap="round" opacity=".78"/>`,
    `<g data-part="ink-echo" opacity="${n(vector.inkEcho * 0.22)}" transform="translate(1.6 .8)">`,
    `<path data-part="echo-left" d="${eyes.left}" fill="${theme.ink}"/>`,
    `<path data-part="echo-right" d="${eyes.right}" fill="${theme.ink}"/>`,
    "</g>",
    `<g data-part="face" transform="${eyes.transform}">`,
    `<path data-part="eye-left" d="${eyes.left}" fill="${theme.ink}"/>`,
    `<path data-part="eye-right" d="${eyes.right}" fill="${theme.ink}"/>`,
    "</g>",
    "</g>",
    `<path data-part="crown-signal" d="M 43.1 10.6 C 46.8 7.9 53.2 7.9 56.9 10.6" fill="none" stroke="${theme.signalYellow}" stroke-width="2.2" stroke-linecap="round" opacity="${n(vector.crownSignal * 0.9)}"/>`,
    `<path data-part="gate-left" d="M 21.8 40.6 C 19.7 46 19.7 52 21.8 57.4" fill="none" stroke="${theme.signalYellow}" stroke-width="1.8" stroke-linecap="round" opacity="${n(vector.constraintGate * 0.72)}"/>`,
    `<path data-part="gate-right" d="M 78.2 40.6 C 80.3 46 80.3 52 78.2 57.4" fill="none" stroke="${theme.signalYellow}" stroke-width="1.8" stroke-linecap="round" opacity="${n(vector.constraintGate * 0.72)}"/>`,
    "</svg>"
  ].join("");
}

export function renderLogoSvg(
  theme: "light" | "dark" = "light",
  size = 160
): string {
  return renderStaticSvg({
    state: "idle",
    theme,
    size,
    idPrefix: `talos-ball-logo-${theme}`,
    title: "TalosBall"
  });
}

export function isOrbState(value: string | null): value is OrbState {
  return value !== null && Object.hasOwn(STATE_VECTORS, value);
}
