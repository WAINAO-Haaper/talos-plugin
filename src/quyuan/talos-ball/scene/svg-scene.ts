import { generateValveEyes } from "../expression/valve-eye";
import { generateCrownKeelPath } from "../form/crown-keel";
import type { MotionSample } from "../kinetics/motion";
import type { VisualVector } from "../semantics/state-vectors";
import type {
  GazePoint,
  OrbState,
  OrbThemeInput
} from "../semantics/types";
import { resolveTheme } from "../surface/tokens";
import { renderStaticSvg } from "./static-svg";

interface SceneParts {
  svg: SVGSVGElement;
  gradientSurfaceTop: SVGStopElement;
  gradientSurfaceBase: SVGStopElement;
  gradientEdgeBlue: SVGStopElement;
  gradientEdgeInk: SVGStopElement;
  shadow: SVGEllipseElement;
  blueAura: SVGCircleElement;
  yellowAura: SVGCircleElement;
  orbit: SVGPathElement;
  bodyGroup: SVGGElement;
  body: SVGPathElement;
  bodyGlaze: SVGPathElement;
  core: SVGEllipseElement;
  sheen: SVGPathElement;
  face: SVGGElement;
  leftEye: SVGPathElement;
  rightEye: SVGPathElement;
  inkEcho: SVGGElement;
  echoLeft: SVGPathElement;
  echoRight: SVGPathElement;
  crownSignal: SVGPathElement;
  gateLeft: SVGPathElement;
  gateRight: SVGPathElement;
}

function element<T extends Element>(
  root: ParentNode,
  selector: string
): T {
  const value = root.querySelector<T>(selector);
  if (!value) throw new Error(`TalosBall scene part is missing: ${selector}`);
  return value;
}

function n(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export class SvgScene {
  readonly #root: ShadowRoot;
  readonly #parts: SceneParts;
  #theme: OrbThemeInput;
  #state: OrbState;
  #idPrefix: string;

  constructor(
    root: ShadowRoot,
    state: OrbState,
    theme: OrbThemeInput,
    idPrefix: string
  ) {
    this.#root = root;
    this.#theme = theme;
    this.#state = state;
    this.#idPrefix = idPrefix;
    const activeWindow = root.ownerDocument.defaultView;
    if (!activeWindow) throw new Error("TALOS Ball requires an active window");
    const style = root.ownerDocument.createElement("style");
    style.textContent = [
      ":host{display:inline-block;width:var(--talos-orb-size,160px);height:var(--talos-orb-size,160px);contain:layout paint style;line-height:0}",
      "svg{display:block;width:100%;height:100%;overflow:visible}",
    ].join("");
    const parsedDocument = new activeWindow.DOMParser().parseFromString(
      renderStaticSvg({ state, theme, size: 160, idPrefix }),
      "image/svg+xml"
    );
    const svg = root.ownerDocument.importNode(
      parsedDocument.documentElement,
      true
    );
    root.replaceChildren(style, svg);
    this.#parts = {
      svg: element(root, "svg[data-talos-orb]"),
      gradientSurfaceTop: element(root, '[data-part="gradient-surface-top"]'),
      gradientSurfaceBase: element(root, '[data-part="gradient-surface-base"]'),
      gradientEdgeBlue: element(root, '[data-part="gradient-edge-blue"]'),
      gradientEdgeInk: element(root, '[data-part="gradient-edge-ink"]'),
      shadow: element(root, '[data-part="shadow"]'),
      blueAura: element(root, '[data-part="blue-aura"]'),
      yellowAura: element(root, '[data-part="yellow-aura"]'),
      orbit: element(root, '[data-part="orbit"]'),
      bodyGroup: element(root, '[data-part="body-group"]'),
      body: element(root, '[data-part="body"]'),
      bodyGlaze: element(root, '[data-part="body-glaze"]'),
      core: element(root, '[data-part="core"]'),
      sheen: element(root, '[data-part="sheen"]'),
      face: element(root, '[data-part="face"]'),
      leftEye: element(root, '[data-part="eye-left"]'),
      rightEye: element(root, '[data-part="eye-right"]'),
      inkEcho: element(root, '[data-part="ink-echo"]'),
      echoLeft: element(root, '[data-part="echo-left"]'),
      echoRight: element(root, '[data-part="echo-right"]'),
      crownSignal: element(root, '[data-part="crown-signal"]'),
      gateLeft: element(root, '[data-part="gate-left"]'),
      gateRight: element(root, '[data-part="gate-right"]')
    };
  }

  set state(value: OrbState) {
    this.#state = value;
    this.#parts.svg.dataset.state = value;
  }

  setTheme(input: OrbThemeInput): void {
    this.#theme = input;
    const theme = resolveTheme(input);
    const style = this.#parts.svg.style;
    style.setProperty("--talos-orb-background", theme.background);
    style.setProperty("--talos-orb-surface", theme.surface);
    style.setProperty("--talos-orb-ink", theme.ink);
    style.setProperty("--talos-orb-blue", theme.cloudBlue);
    style.setProperty("--talos-orb-yellow", theme.signalYellow);
    this.#parts.gradientSurfaceTop.setAttribute("stop-color", theme.surface);
    this.#parts.gradientSurfaceBase.setAttribute("stop-color", theme.surface);
    this.#parts.gradientEdgeBlue.setAttribute("stop-color", theme.cloudBlue);
    this.#parts.gradientEdgeInk.setAttribute("stop-color", theme.ink);
    this.#parts.shadow.setAttribute("fill", theme.ink);
    this.#parts.blueAura.setAttribute("stroke", theme.cloudBlue);
    this.#parts.yellowAura.setAttribute("stroke", theme.signalYellow);
    this.#parts.orbit.setAttribute("stroke", theme.cloudBlue);
    this.#parts.body.setAttribute("fill", theme.surface);
    this.#parts.body.setAttribute("stroke", theme.ink);
    this.#parts.core.setAttribute("fill", theme.signalYellow);
    this.#parts.sheen.setAttribute("stroke", theme.surface);
    this.#parts.leftEye.setAttribute("fill", theme.ink);
    this.#parts.rightEye.setAttribute("fill", theme.ink);
    this.#parts.echoLeft.setAttribute("fill", theme.ink);
    this.#parts.echoRight.setAttribute("fill", theme.ink);
    this.#parts.crownSignal.setAttribute("stroke", theme.signalYellow);
    this.#parts.gateLeft.setAttribute("stroke", theme.signalYellow);
    this.#parts.gateRight.setAttribute("stroke", theme.signalYellow);
  }

  apply(
    vector: Readonly<VisualVector>,
    motion: Readonly<MotionSample>,
    gaze: Readonly<GazePoint>,
    blink: number
  ): void {
    const animated: VisualVector = {
      ...vector,
      bodyScaleX: vector.bodyScaleX + motion.breathX,
      bodyScaleY: vector.bodyScaleY + motion.breathY,
      lift: vector.lift + motion.lift,
      lean: vector.lean + motion.lean + motion.errorJitter * 1.8
    };
    const eyes = generateValveEyes(animated, gaze, blink);
    const parts = this.#parts;
    const bodyLean = animated.lean + motion.errorJitter * 1.4;
    const auraPulse = 0.82 + motion.auraPulse * 0.18;
    const corePulse = Math.max(vector.core * 0.42, motion.corePulse);

    parts.body.setAttribute("d", generateCrownKeelPath(animated));
    parts.bodyGlaze.setAttribute("d", parts.body.getAttribute("d") ?? "");
    parts.bodyGroup.setAttribute("transform", `rotate(${n(bodyLean)} 50 49)`);
    parts.face.setAttribute("transform", eyes.transform);
    parts.leftEye.setAttribute("d", eyes.left);
    parts.rightEye.setAttribute("d", eyes.right);
    parts.echoLeft.setAttribute("d", eyes.left);
    parts.echoRight.setAttribute("d", eyes.right);
    parts.inkEcho.setAttribute("opacity", n(vector.inkEcho * (0.14 + Math.abs(motion.errorJitter) * 0.2)));
    parts.inkEcho.setAttribute(
      "transform",
      `translate(${n(1.1 + motion.errorJitter * 1.8)} ${n(0.7 - motion.errorJitter)})`
    );

    parts.shadow.setAttribute("cx", n(50 + bodyLean * 0.12));
    parts.shadow.setAttribute("rx", n(25.8 * animated.bodyScaleX));
    parts.shadow.setAttribute(
      "opacity",
      n(0.08 + Math.max(0, animated.lift + 1.5) * 0.014)
    );
    parts.blueAura.setAttribute("r", n(42.4 + vector.blueAura * 1.8 + motion.auraPulse * 0.35));
    parts.blueAura.setAttribute("opacity", n(vector.blueAura * 0.34 * auraPulse));
    parts.yellowAura.setAttribute("r", n(41.7 + vector.yellowAura * 1.2 + motion.corePulse * 1.6));
    parts.yellowAura.setAttribute("opacity", n(vector.yellowAura * 0.36 * auraPulse));
    parts.orbit.setAttribute("opacity", n(vector.orbit * 0.78));
    parts.orbit.setAttribute(
      "transform",
      `rotate(${n(motion.orbitAngle)} 50 49)`
    );
    parts.core.setAttribute("rx", n(13.5 + corePulse * 3.1));
    parts.core.setAttribute("ry", n(10.5 + corePulse * 2.2));
    parts.core.setAttribute("opacity", n(Math.min(0.28, vector.core * 0.13 + corePulse * 0.14)));
    parts.crownSignal.setAttribute(
      "opacity",
      n(vector.crownSignal * (0.58 + motion.auraPulse * 0.32))
    );
    const gateOpacity = n(vector.constraintGate * 0.72);
    parts.gateLeft.setAttribute("opacity", gateOpacity);
    parts.gateRight.setAttribute("opacity", gateOpacity);
  }

  renderStatic(): string {
    return renderStaticSvg({
      state: this.#state,
      theme: this.#theme,
      size: 160,
      idPrefix: `${this.#idPrefix}-static`
    });
  }

  destroy(): void {
    this.#root.replaceChildren();
  }
}
