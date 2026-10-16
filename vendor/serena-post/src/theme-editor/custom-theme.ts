/**
 * 自定义排版：以一套内置排版为底，叠加可视化编辑器生成的覆盖样式。
 * 覆盖样式放在主题 CSS 之后，内联时后写的规则生效，所以预览和发布结果一致。
 */

export const EXPORT_FORMAT = 'serenapost-theme';
export const EXPORT_VERSION = 1;

export type Choice<T extends string> = T;

export interface CustomThemeDef {
	id: string;
	name: string;
	/** 作为底的内置排版名称 */
	base: string;
	/** 主色（空 = 用底的主色） */
	accent: string;
	fontFamily: 'theme' | 'sans' | 'serif' | 'kai' | 'rounded';
	fontSize: number;          // px
	lineHeight: number;        // 倍数
	letterSpacing: number;     // em
	paragraphSpacing: number;  // px
	textColor: string;         // 空 = 用底的
	textAlign: 'theme' | 'justify' | 'left';
	headingAlign: 'theme' | 'left' | 'center';
	h2Style: 'theme' | 'bar' | 'underline' | 'pill' | 'plain';
	quoteStyle: 'theme' | 'bar' | 'card' | 'plain';
	boldColor: 'theme' | 'accent' | 'text';
	imageRadius: number;       // px，-1 = 用底的
	imageShadow: boolean;
	createdAt: string;
}

export const FONT_STACKS: Record<CustomThemeDef['fontFamily'], { label: string; stack: string }> = {
	theme: { label: '跟随底版', stack: '' },
	sans: { label: '黑体（默认无衬线）', stack: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif' },
	serif: { label: '宋体（衬线）', stack: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", SimSun, serif' },
	kai: { label: '楷体', stack: '"Kaiti SC", STKaiti, KaiTi, "BiauKai", serif' },
	rounded: { label: '圆体', stack: '"Yuanti SC", "PingFang SC", "Microsoft YaHei", sans-serif' }
};

export function newThemeId(): string {
	return 'ct-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function defaultDef(base: string, baseAccent: string): CustomThemeDef {
	return {
		id: newThemeId(),
		name: '',
		base,
		accent: baseAccent || '#07c160',
		fontFamily: 'theme',
		fontSize: 16,
		lineHeight: 1.8,
		letterSpacing: 0.03,
		paragraphSpacing: 20,
		textColor: '',
		textAlign: 'theme',
		headingAlign: 'theme',
		h2Style: 'theme',
		quoteStyle: 'theme',
		boldColor: 'theme',
		imageRadius: -1,
		imageShadow: false,
		createdAt: new Date().toISOString()
	};
}

function hexToRgb(hex: string): [number, number, number] | null {
	const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
	if (!m) return null;
	let h = m[1];
	if (h.length === 3) h = h.split('').map(c => c + c).join('');
	const n = parseInt(h, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 主色的浅色版本（用于底色），amount 0~1 越大越浅 */
export function tint(hex: string, amount: number): string {
	const rgb = hexToRgb(hex);
	if (!rgb) return hex;
	const mix = rgb.map(v => Math.round(v + (255 - v) * amount));
	return '#' + mix.map(v => v.toString(16).padStart(2, '0')).join('');
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把底版 CSS 里出现的旧主色整体换成新主色（含 rgb 写法） */
export function recolor(css: string, from: string, to: string): string {
	if (!from || !to || from.toLowerCase() === to.toLowerCase()) return css;
	let out = css.replace(new RegExp(escapeRe(from), 'gi'), to);
	const a = hexToRgb(from);
	const b = hexToRgb(to);
	if (a && b) {
		out = out.replace(new RegExp(`rgba?\\(\\s*${a[0]}\\s*,\\s*${a[1]}\\s*,\\s*${a[2]}`, 'g'), m =>
			m.replace(/\(\s*\d+\s*,\s*\d+\s*,\s*\d+/, `(${b[0]}, ${b[1]}, ${b[2]}`));
	}
	return out;
}

/** 根据编辑器设置生成覆盖样式（追加在底版 CSS 之后） */
export function generateOverrideCss(d: CustomThemeDef, baseAccent: string): string {
	const accent = d.accent || baseAccent || '#07c160';
	const r: string[] = [];
	const root = '.note-to-mp';
	const text: string[] = [];

	const font = FONT_STACKS[d.fontFamily]?.stack;
	if (font) text.push(`font-family: ${font} !important;`);
	text.push(`font-size: ${d.fontSize}px !important;`);
	text.push(`line-height: ${d.lineHeight} !important;`);
	text.push(`letter-spacing: ${d.letterSpacing}em !important;`);
	if (d.textColor) text.push(`color: ${d.textColor} !important;`);
	r.push(`${root} { ${text.join(' ')} }`);

	const p: string[] = [
		`font-size: ${d.fontSize}px !important;`,
		`line-height: ${d.lineHeight} !important;`,
		`letter-spacing: ${d.letterSpacing}em !important;`,
		`margin: 0 0 ${d.paragraphSpacing}px !important;`
	];
	if (font) p.push(`font-family: ${font} !important;`);
	if (d.textColor) p.push(`color: ${d.textColor} !important;`);
	if (d.textAlign !== 'theme') p.push(`text-align: ${d.textAlign} !important;`);
	r.push(`${root} p, ${root} li { ${p.join(' ')} }`);
	if (font) r.push(`${root} h1, ${root} h2, ${root} h3, ${root} h4 { font-family: ${font} !important; }`);

	if (d.headingAlign !== 'theme') {
		r.push(`${root} h1, ${root} h2, ${root} h3 { text-align: ${d.headingAlign} !important; }`);
	}

	switch (d.h2Style) {
		case 'bar':
			r.push(`${root} h2 { border: none !important; border-left: 4px solid ${accent} !important; background: none !important; border-radius: 0 !important; padding: 2px 0 2px 12px !important; color: ${accent} !important; display: block !important; }`);
			break;
		case 'underline':
			r.push(`${root} h2 { border: none !important; border-bottom: 2px solid ${accent} !important; background: none !important; border-radius: 0 !important; padding: 0 0 8px !important; color: ${accent} !important; display: block !important; }`);
			break;
		case 'pill':
			r.push(`${root} h2 { border: none !important; background: ${accent} !important; color: #ffffff !important; border-radius: 999px !important; padding: 6px 18px !important; display: table !important; ${d.headingAlign === 'center' ? 'margin-left: auto !important; margin-right: auto !important;' : ''} }`);
			break;
		case 'plain':
			r.push(`${root} h2 { border: none !important; background: none !important; border-radius: 0 !important; padding: 0 !important; color: inherit !important; display: block !important; }`);
			break;
	}

	switch (d.quoteStyle) {
		case 'bar':
			r.push(`${root} blockquote { border: none !important; border-left: 3px solid ${accent} !important; background: none !important; border-radius: 0 !important; padding: 4px 0 4px 14px !important; color: #6b7280 !important; }`);
			break;
		case 'card':
			r.push(`${root} blockquote { border: none !important; background: ${tint(accent, 0.9)} !important; border-radius: 10px !important; padding: 14px 16px !important; color: #374151 !important; }`);
			break;
		case 'plain':
			r.push(`${root} blockquote { border: none !important; background: none !important; padding: 0 !important; color: #6b7280 !important; font-style: italic; }`);
			break;
	}

	if (d.boldColor === 'accent') r.push(`${root} strong { color: ${accent} !important; }`);
	if (d.boldColor === 'text') r.push(`${root} strong { color: inherit !important; }`);

	const img: string[] = [];
	if (d.imageRadius >= 0) img.push(`border-radius: ${d.imageRadius}px !important;`);
	if (d.imageShadow) img.push('box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12) !important;');
	if (img.length) r.push(`${root} img { ${img.join(' ')} }`);

	return `\n/* SerenaPost 自定义排版：${d.name || '未命名'} */\n${r.join('\n')}\n`;
}

/** 底版 CSS → 换主色 → 叠加覆盖样式 */
export function buildCustomCss(baseCss: string, baseAccent: string, d: CustomThemeDef): string {
	const accent = d.accent || baseAccent;
	return recolor(baseCss, baseAccent, accent) + generateOverrideCss(d, baseAccent);
}

/** 导出文件内容 */
export function exportThemeJson(d: CustomThemeDef): string {
	const { id: _id, ...rest } = d;
	return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, theme: rest }, null, 2);
}

const ENUMS: Partial<Record<keyof CustomThemeDef, string[]>> = {
	fontFamily: Object.keys(FONT_STACKS),
	textAlign: ['theme', 'justify', 'left'],
	headingAlign: ['theme', 'left', 'center'],
	h2Style: ['theme', 'bar', 'underline', 'pill', 'plain'],
	quoteStyle: ['theme', 'bar', 'card', 'plain'],
	boldColor: ['theme', 'accent', 'text']
};

const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6})?$/i;

function clamp(n: unknown, min: number, max: number, fallback: number): number {
	const v = typeof n === 'number' ? n : parseFloat(String(n));
	return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** 解析并校验导入文件；不合法时抛出中文错误。只接受白名单字段，防止注入任意样式 */
export function parseThemeJson(raw: string, knownBases: string[], fallbackBase: string): CustomThemeDef {
	let data: any;
	try {
		data = JSON.parse(raw);
	} catch {
		throw new Error('不是有效的排版文件（JSON 格式错误）');
	}
	if (!data || data.format !== EXPORT_FORMAT || typeof data.theme !== 'object') {
		throw new Error('不是 SerenaPost 排版文件');
	}
	const t = data.theme;
	const base = knownBases.includes(t.base) ? t.base : fallbackBase;
	const d = defaultDef(base, '');
	d.name = String(t.name || '导入的排版').slice(0, 30);
	d.accent = typeof t.accent === 'string' && COLOR_RE.test(t.accent) ? t.accent : '';
	d.textColor = typeof t.textColor === 'string' && COLOR_RE.test(t.textColor) ? t.textColor : '';
	for (const [key, values] of Object.entries(ENUMS)) {
		const v = t[key];
		if (typeof v === 'string' && values!.includes(v)) (d as any)[key] = v;
	}
	d.fontSize = clamp(t.fontSize, 12, 22, 16);
	d.lineHeight = clamp(t.lineHeight, 1.2, 2.6, 1.8);
	d.letterSpacing = clamp(t.letterSpacing, 0, 0.2, 0.03);
	d.paragraphSpacing = clamp(t.paragraphSpacing, 0, 48, 20);
	d.imageRadius = clamp(t.imageRadius, -1, 32, -1);
	d.imageShadow = Boolean(t.imageShadow);
	return d;
}
