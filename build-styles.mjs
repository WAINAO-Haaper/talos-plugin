import {
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const talosSource = resolve(root, "styles.talos.css");
const upstreamRoot = resolve(root, "src/quyuan/claudian/style");
const upstreamIndex = resolve(upstreamRoot, "index.css");
const quyuanShellSource = resolve(root, "styles.quyuan-shell.css");
const layoutOverridesSource = resolve(root, "styles.layout-overrides.css");
const output = resolve(root, "styles.css");
const importPattern = /^\s*@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/gm;

if (!existsSync(talosSource)) throw new Error("Missing styles.talos.css");
if (!existsSync(upstreamIndex)) throw new Error("Missing Claudian style/index.css");
if (!existsSync(quyuanShellSource)) throw new Error("Missing styles.quyuan-shell.css");
if (!existsSync(layoutOverridesSource)) throw new Error("Missing styles.layout-overrides.css");

const index = readFileSync(upstreamIndex, "utf8");
const imports = [...index.matchAll(importPattern)].map((match) => match[1]);
if (imports.length === 0) throw new Error("Claudian style index has no imports");

const parts = [
	"/* GENERATED FILE — edit styles.talos.css or src/quyuan/claudian/style/** */",
	readFileSync(talosSource, "utf8"),
	"\n/* Quyuan v2 workbench styles · derived from Claudian 2.0.25 */\n",
];

for (const modulePath of imports) {
	if (!modulePath) continue;
	const file = resolve(upstreamRoot, modulePath);
	const rel = relative(upstreamRoot, file);
	if (rel.startsWith("..") || !rel.endsWith(".css")) {
		throw new Error(`Unsafe style import: ${modulePath}`);
	}
	if (!existsSync(file)) throw new Error(`Missing style module: ${rel}`);
	parts.push(`\n/* upstream: ${rel} */\n`, readFileSync(file, "utf8"));
}

parts.push(
	"\n/* TALOS Quyuan v1 visual shell over the v2 runtime */\n",
	readFileSync(quyuanShellSource, "utf8"),
	"\n/* TALOS 2.0 validated console and chat layout overrides */\n",
	readFileSync(layoutOverridesSource, "utf8")
);

/**
 * 结构自检（2026-07-10 加）：styles.talos.css 曾有一行 var() 链少一个 `)`，
 * 浏览器静默吞掉其后约一万行规则（屈原页整段 CSS 失效 → 白屏），无任何报错。
 * 这里做两道检查：① 逐行检查以 `;` 结尾的声明行括号配对；② 全文件（剥离
 * 注释与字符串后）的 () [] {} 全局平衡。任一失败即构建失败，快败于静默。
 */
function validateCss(css, label) {
	const errors = [];
	// 预处理：注释、字符串、url(...) 整体置换为空白（保留换行以便报行号）
	const blank = (m) => m.replace(/[^\n]/g, " ");
	const stripped = css
		.replace(/\/\*[\s\S]*?\*\//g, blank)
		.replace(/"[^"\n]*"|'[^'\n]*'/g, blank)
		.replace(/url\(\s*[^)"'\s][^)]*\)/g, blank);
	// 流式扫描：括号深度 >0 时遇到 ; 或 } —— 即「未闭合括号吞掉后续规则」的
	// 致命形态（浏览器会静默丢弃直到括号配平为止的所有内容）
	let line = 1;
	let parenDepth = 0;
	let parenOpenLine = 0;
	for (const ch of stripped) {
		if (ch === "\n") { line++; continue; }
		if (ch === "(") { if (parenDepth === 0) parenOpenLine = line; parenDepth++; }
		else if (ch === ")") { if (parenDepth > 0) parenDepth--; }
		else if ((ch === ";" || ch === "}") && parenDepth > 0) {
			errors.push(
				`${label}:${line} 括号深度 ${parenDepth} 时遇到 \`${ch}\`（未闭合的 \`(\` 起于第 ${parenOpenLine} 行）——会吞掉其后所有规则`
			);
			parenDepth = 0;
		}
	}
	// 全局平衡兜底
	for (const [o, c, name] of [["(", ")", "()"], ["[", "]", "[]"], ["{", "}", "{}"]]) {
		const open = (stripped.match(new RegExp(`\\${o}`, "g")) || []).length;
		const close = (stripped.match(new RegExp(`\\${c}`, "g")) || []).length;
		if (open !== close) errors.push(`${label}: 全文件 ${name} 不平衡（${open} vs ${close}）`);
	}
	return errors;
}

const combined = parts.join("\n");
const cssErrors = validateCss(combined, "styles.css");
if (cssErrors.length > 0) {
	console.error("CSS 结构自检失败：\n" + cssErrors.join("\n"));
	process.exit(1);
}

writeFileSync(output, combined, "utf8");
console.log(`Built TALOS + Quyuan styles (${Math.round(combined.length / 1024)} KB), 结构自检通过`);
