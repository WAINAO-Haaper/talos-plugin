/**
 * 章节（二级标题）样式：可以套在任何排版上，参考 Punk微排 的 9 种章节样式。
 * 另外支持在标题前放 IP 头像、文末加「SERENA · END」标记。
 */
import { tint } from '../theme-editor/custom-theme';

export type HeadingStyleId =
	| 'theme' | 'underline' | 'slash' | 'leftbar' | 'box' | 'bracket'
	| 'dots' | 'matrix' | 'superscript' | 'quote';

export interface HeadingStyleDef {
	id: HeadingStyleId;
	label: string;
	/** 是否使用「01」序号（会去掉标题自带的「一、」） */
	numbered: boolean;
	/** 标题前的符号；numbered 时为序号 */
	prefix?: string;
	/** 标题后的符号 */
	suffix?: string;
}

export const HEADING_STYLES: HeadingStyleDef[] = [
	{ id: 'theme', label: '跟随排版', numbered: false },
	{ id: 'underline', label: '粗下划线　01 标题', numbered: true },
	{ id: 'slash', label: '斜线　／ 标题', numbered: false, prefix: '／' },
	{ id: 'leftbar', label: '左竖线　▌标题', numbered: false },
	{ id: 'box', label: '方框　□ 标题', numbered: false },
	{ id: 'bracket', label: '方括号　［标题］', numbered: false, prefix: '［', suffix: '］' },
	{ id: 'dots', label: '双圆　● 标题', numbered: false, prefix: '●' },
	{ id: 'matrix', label: '点阵　∷ 标题 ∷', numbered: false, prefix: '∷', suffix: '∷' },
	{ id: 'superscript', label: '上置序号　⁰¹ 标题', numbered: true },
	{ id: 'quote', label: '引号　「 标题', numbered: false, prefix: '「' }
];

export function headingStyleDef(id: string | undefined): HeadingStyleDef | undefined {
	if (!id || id === 'theme') return undefined;
	return HEADING_STYLES.find(s => s.id === id);
}

const ROOT = '.note-to-mp';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** 章节样式的 CSS（追加在排版 CSS 之后，覆盖排版自带的二级标题样式） */
export function headingStyleCss(id: string | undefined, accent: string, accent2?: string): string {
	const def = headingStyleDef(id);
	if (!def) return '';
	const a = accent || '#0058a3';
	const b = accent2 || tint(a, 0.35);
	const h = `${ROOT} h2.sp-h`;
	const lab = `${h} .wechatpb-heading-label`;
	const suf = `${h} .sp-h-suffix`;
	const r: string[] = [];
	r.push(`${h} { display: block !important; margin: 40px 0 20px !important; padding: 0 !important; border: none !important; border-radius: 0 !important; background: none !important; box-shadow: none !important; text-align: left !important; color: ${a} !important; font-size: 19px !important; font-weight: 900 !important; line-height: 1.5 !important; letter-spacing: 0.5px !important; }`);
	r.push(`${lab} { display: inline !important; margin: 0 8px 0 0 !important; padding: 0 !important; border: none !important; background: none !important; color: ${b} !important; font-size: inherit !important; font-weight: 900 !important; font-family: inherit !important; }`);
	r.push(`${h}.sp-has-avatar .sp-h-text { display: inline-block !important; max-width: 82% !important; vertical-align: middle !important; }`);
	r.push(`${suf} { display: inline !important; margin: 0 0 0 8px !important; color: ${b} !important; font-weight: 900 !important; }`);

	switch (def.id) {
		case 'underline':
			r.push(`${h} { display: table !important; margin: 44px auto 24px !important; padding: 0 4px 6px !important; border-bottom: 4px solid ${b} !important; text-align: center !important; }`);
			r.push(`${lab} { color: ${a} !important; font-family: ${MONO} !important; margin-right: 10px !important; }`);
			// 有头像时：下划线只划在「01 + 标题」下面
			r.push(`${h}.sp-has-avatar { padding: 0 !important; border-bottom: none !important; }`);
			r.push(`${h}.sp-has-avatar .sp-h-text { display: inline-block !important; max-width: 82% !important; padding: 0 4px 6px !important; border-bottom: 4px solid ${b} !important; vertical-align: middle !important; }`);
			break;
		case 'slash':
			r.push(`${lab} { font-size: 22px !important; font-weight: 400 !important; margin-right: 4px !important; }`);
			break;
		case 'leftbar':
			r.push(`${h} { padding: 2px 0 2px 12px !important; border-left: 6px solid ${a} !important; }`);
			break;
		case 'box':
			r.push(`${h} { display: table !important; padding: 6px 16px !important; border: 2px solid ${a} !important; }`);
			break;
		case 'bracket':
			r.push(`${lab} { margin-right: 2px !important; }`);
			r.push(`${suf} { margin-left: 2px !important; }`);
			break;
		case 'dots':
			r.push(`${lab} { font-size: 14px !important; vertical-align: 2px !important; margin-right: 8px !important; }`);
			r.push(`${h} .sp-h-dot2 { color: ${a} !important; margin-right: 4px !important; }`);
			break;
		case 'matrix':
			r.push(`${h} { text-align: center !important; margin: 44px 0 24px !important; }`);
			r.push(`${lab} { margin-right: 10px !important; }`);
			r.push(`${suf} { margin-left: 10px !important; }`);
			break;
		case 'superscript':
			r.push(`${lab} { display: block !important; margin: 0 0 2px !important; font-family: ${MONO} !important; font-size: 13px !important; letter-spacing: 3px !important; line-height: 1.4 !important; }`);
			break;
		case 'quote':
			r.push(`${lab} { font-size: 26px !important; line-height: 1 !important; margin-right: 2px !important; vertical-align: -2px !important; }`);
			break;
	}
	return `\n/* SerenaPost 章节样式：${def.label} */\n${r.join('\n')}\n`;
}

/** 标题前 IP 头像 + 文末 END 标记的 CSS */
export function brandingCss(accent: string, accent2?: string): string {
	const a = accent || '#0058a3';
	const b = accent2 || tint(a, 0.35);
	return `
/* SerenaPost 品牌元素 */
${ROOT} img.sp-h-avatar { display: inline-block !important; width: 44px !important; height: 44px !important; max-width: 44px !important; margin: 0 8px 0 0 !important; padding: 0 !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; vertical-align: middle !important; background: none !important; object-fit: contain; }
${ROOT} .sp-end { display: block !important; margin: 48px 0 8px !important; padding: 14px 0 0 !important; border-top: 1px solid ${tint(a, 0.75)} !important; text-align: center !important; }
${ROOT} .sp-end-text { display: inline-block !important; color: ${a} !important; font-size: 13px !important; font-style: italic !important; font-weight: 700 !important; letter-spacing: 3px !important; line-height: 1.6 !important; }
`;
}

/** 高亮（==文字==）：主题色的浅底 */
export function markCss(accent: string): string {
	const bg = tint(accent || '#53a4ea', 0.75);
	return `\n.note-to-mp .sp-mark { background: ${bg} !important; color: inherit !important; padding: 0 3px !important; border-radius: 3px !important; }\n`;
}
