import "./vendor/emotion-ball/rings.js";
import "./vendor/emotion-ball/emotions.js";
import "./vendor/emotion-ball/ball.js";
import "./vendor/emotion-ball/engine.js";
import type {
	EmotionBallEngine,
	EmotionBallEngineOptions,
	EmotionBallFactory,
} from "./emotion-ball-view";

interface EmotionBallNamespace {
	version?: string;
	create(host: HTMLElement, options: EmotionBallEngineOptions): EmotionBallEngine;
}

declare global {
	interface Window {
		EmotionBall?: EmotionBallNamespace;
	}
}

export const EMOTION_BALL_UPSTREAM = Object.freeze({
	repository: "sam70361/emotion-ball",
	commit: "b406eeb20a1b1ae0084d4006e77cc74e28be009d",
	engineVersion: "1.0.0",
});

export const createPinnedEmotionBall: EmotionBallFactory = (host, options) => {
	const runtime = window.EmotionBall;
	if (!runtime?.create) {
		throw new Error("Pinned Emotion Ball runtime is unavailable");
	}
	return runtime.create(host, options);
};
