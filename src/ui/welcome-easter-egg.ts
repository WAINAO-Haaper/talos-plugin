import type { App } from "obsidian";

/**
 * 开屏欢迎彩蛋：用户打开 TALOS 控制台时，头像带长条彩带弹跳入场，
 * 展示插件说明与作者信息，引导用户部署完整 TALOS 系统。
 * 每次打开视图播放一次；「不再显示」按钮通过 onNeverShow 永久关闭。
 * 头像优先使用插件目录下的 avatar.png / avatar.jpg / avatar.jpeg / avatar.webp，
 * 缺失时回退到 TALOS 吉祥物图。
 */

const AVATAR_CANDIDATES = [
	"avatar.png",
	"avatar.jpg",
	"avatar.jpeg",
	"avatar.webp",
] as const;

const FALLBACK_MASCOT = "TALOS-Mascot-Character-Transparent-v1.png";
const AUTO_DISMISS_MS = 15000;
const LEAVE_ANIMATION_MS = 320;

const GITHUB_URL = "https://github.com/WAINAO-Haaper/talos-plugin";
const GITHUB_LABEL = "github.com/WAINAO-Haaper/talos-plugin";

const CONFETTI_COLORS = [
	"#f9705c",
	"#5b95f0",
	"#3fbe86",
	"#f5b13f",
	"#9a72ee",
	"#35c3bd",
] as const;
const CONFETTI_COUNT = 28;

const EASTER_EGG_SECTIONS: ReadonlyArray<{
	title: string;
	body: string;
}> = [
	{
		title: "这是什么？",
		body: "本插件是「TALOS 外脑系统」的驾驶舱：一套长在 Obsidian 上的个人数据管理架构，项目、任务、知识、输出全部结构化，由 AI 智能体驱动自动流转。",
	},
	{
		title: "个性化改造",
		body: "本插件基于 TALOS 系统架构开发。安装后，可让任意大模型读取代码，并按照你的需求调整目录与功能。",
	},
	{
		title: "为什么有些功能跑不起来？",
		body: "AI 对话、语音助手、自动化命令等模块都生长在 TALOS 系统架构之上，需要按你的目录结构和工作流单独部署配置，才能真正激活。",
	},
];

const CONTACT_LINES: ReadonlyArray<string> = [
	"全网名称：外脑玩家 Haaper",
	"微信：wadeonly",
	"邮箱：han747266@gmail.com",
];

export interface WelcomeEasterEggOptions {
	app: App;
	/** 插件在库内的目录（manifest.dir），用于定位头像资源 */
	pluginDir: string | undefined;
	/** 彩蛋挂载点（视图 contentEl） */
	container: HTMLElement;
	/** 用户点「不再显示」时调用：把开屏彩蛋开关关掉并保存设置 */
	onNeverShow: () => void | Promise<void>;
}

async function resolveAvatarPath(
	app: App,
	pluginDir: string | undefined
): Promise<string | null> {
	if (!pluginDir) return null;
	for (const name of AVATAR_CANDIDATES) {
		const candidate = `${pluginDir}/${name}`;
		if (await app.vault.adapter.exists(candidate)) return candidate;
	}
	const mascot = `${pluginDir}/${FALLBACK_MASCOT}`;
	if (await app.vault.adapter.exists(mascot)) return mascot;
	return null;
}

function spawnConfetti(overlay: HTMLElement): void {
	const host = overlay.createDiv({ cls: "talos-welcome-confetti" });
	for (let i = 0; i < CONFETTI_COUNT; i++) {
		const piece = host.createSpan({ cls: "talos-welcome-confetti-piece" });
		const color =
			CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
		piece.style.left = `${Math.random() * 100}%`;
		piece.style.setProperty("--confetti-color", color);
		piece.style.setProperty(
			"--confetti-drift",
			`${(Math.random() - 0.5) * 160}px`
		);
		piece.style.setProperty(
			"--confetti-delay",
			`${(Math.random() * 1.8).toFixed(2)}s`
		);
		piece.style.setProperty(
			"--confetti-rotate",
			`${Math.floor(Math.random() * 540 + 180)}deg`
		);
		if (Math.random() > 0.5) piece.addClass("is-round");
	}
}

export async function showWelcomeEasterEgg(
	options: WelcomeEasterEggOptions
): Promise<void> {
	const { app, pluginDir, container, onNeverShow } = options;
	if (container.querySelector(".talos-welcome-overlay")) return;

	const overlay = container.createDiv({ cls: "talos-welcome-overlay" });
	overlay.setAttribute("role", "dialog");
	overlay.setAttribute("aria-label", "TALOS 彩蛋");

	spawnConfetti(overlay);

	const card = overlay.createDiv({ cls: "talos-welcome-card" });

	const avatarPath = await resolveAvatarPath(app, pluginDir);
	if (avatarPath) {
		const avatar = card.createEl("img", {
			cls: "talos-welcome-avatar",
			attr: {
				src: app.vault.adapter.getResourcePath(avatarPath),
				alt: "外脑玩家 Haaper 的头像",
			},
		});
		avatar.draggable = false;
	}

	card.createEl("h2", {
		cls: "talos-welcome-title",
		text: "🎁 TALOS 彩蛋｜打造属于你的外脑系统",
	});

	for (const section of EASTER_EGG_SECTIONS) {
		const block = card.createDiv({ cls: "talos-welcome-section" });
		block.createEl("h3", { text: section.title });
		block.createEl("p", { text: section.body });
	}

	const contact = card.createDiv({ cls: "talos-welcome-contact" });
	contact.createEl("h3", { text: "想拥有完整版？联系我部署整套 TALOS System" });
	const list = contact.createEl("ul", { cls: "talos-welcome-contact-list" });
	for (const line of CONTACT_LINES) {
		list.createEl("li", { text: line });
	}
	const linkLine = list.createEl("li");
	linkLine.createSpan({ text: "系统介绍：" });
	linkLine.createEl("a", {
		cls: "talos-welcome-link",
		text: GITHUB_LABEL,
		href: GITHUB_URL,
	});

	const actions = card.createDiv({ cls: "talos-welcome-actions" });
	const enter = actions.createEl("button", {
		cls: "talos-welcome-enter",
		text: "进入控制台",
		attr: { type: "button" },
	});
	const neverShow = actions.createEl("button", {
		cls: "talos-welcome-never",
		text: "不再显示",
		attr: { type: "button" },
	});

	let dismissed = false;
	let autoTimer: number | null = null;
	const dismiss = (): void => {
		if (dismissed) return;
		dismissed = true;
		if (autoTimer !== null) {
			window.clearTimeout(autoTimer);
			autoTimer = null;
		}
		overlay.addClass("is-leaving");
		window.setTimeout(() => overlay.remove(), LEAVE_ANIMATION_MS);
	};

	enter.addEventListener("click", dismiss);
	neverShow.addEventListener("click", () => {
		void onNeverShow();
		dismiss();
	});
	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) dismiss();
	});
	autoTimer = window.setTimeout(dismiss, AUTO_DISMISS_MS);
}
