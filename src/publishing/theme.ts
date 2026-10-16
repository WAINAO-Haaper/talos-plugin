import { PublishingCheckError } from "./security";
import type { WechatPresentation } from "./types";

export const DEFAULT_WECHAT_PRESENTATION: Readonly<WechatPresentation> = Object.freeze({ fontSize: 15, lineHeight: 1.75, accent: "#576b95" });

export function normalizeWechatPresentation(value?: WechatPresentation): WechatPresentation {
	const input = value === undefined ? DEFAULT_WECHAT_PRESENTATION : value;
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new PublishingCheckError("公众号排版参数无效，请重新选择字号、行距和主题色。");
	if (!Number.isFinite(input.fontSize) || !Number.isInteger(input.fontSize) || input.fontSize < 14 || input.fontSize > 20) {
		throw new PublishingCheckError("公众号字号必须是 14 到 20 之间的整数。");
	}
	if (!Number.isFinite(input.lineHeight) || ![1.5, 1.75, 2, 2.25].includes(input.lineHeight)) {
		throw new PublishingCheckError("公众号行距只支持 1.5、1.75、2 或 2.25。");
	}
	if (typeof input.accent !== "string" || input.accent.length !== 7 || !/^#[a-fA-F0-9]{6}$/.test(input.accent)) {
		throw new PublishingCheckError("公众号主题色必须使用 #RRGGBB 六位十六进制颜色。");
	}
	return { fontSize: input.fontSize, lineHeight: input.lineHeight, accent: input.accent.toLowerCase() };
}

/** Neutral local typography; no fonts, avatar, or network resources. */
export const PUBLISHING_THEME_CSS = `
.note-to-mp { font-size: 15px; color: #333; line-height: 1.75; }
h1 { margin: 1.4em 0 .8em; font-size: 24px; font-weight: bold; }
h2 { margin: 1.4em 0 .8em; font-size: 20px; font-weight: bold; }
h3, h4, h5, h6 { margin: 1.2em 0 .7em; font-size: 17px; font-weight: bold; }
p { margin: 1em 0; line-height: 1.75; }
strong { font-weight: bold; }
em { font-style: italic; }
ul { margin: 1em 0; padding-left: 2em; list-style-type: disc; }
ol { margin: 1em 0; padding-left: 2em; list-style-type: decimal; }
li { margin: .4em 0; }
blockquote { margin: 1em 0; padding: .2em 1em; border-left: 3px solid #aaa; color: #666; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 14px; }
th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
th { font-weight: bold; background-color: #f5f5f5; }
pre { margin: 1em 0; padding: 14px; background-color: #f5f5f5; overflow: auto; white-space: pre; }
code { font-family: Menlo, Monaco, Consolas, monospace; font-size: 13px; }
pre code { display: block; white-space: pre; }
p code, li code { padding: 2px 4px; background-color: #f5f5f5; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
a { color: #576b95; text-decoration: none; }
hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
`;

/** Fixed local rules plus validated numbers/color; arbitrary CSS is not accepted. */
export function wechatPresentationCss(value?: WechatPresentation): string {
	const { fontSize, lineHeight, accent } = normalizeWechatPresentation(value);
	const css = [PUBLISHING_THEME_CSS];
	if (fontSize !== DEFAULT_WECHAT_PRESENTATION.fontSize) css.push(`
.note-to-mp, p, li, blockquote { font-size: ${fontSize}px; }
h1 { font-size: ${fontSize + 9}px; }
h2 { font-size: ${fontSize + 5}px; }
h3, h4, h5, h6 { font-size: ${fontSize + 2}px; }
table { font-size: ${fontSize - 1}px; }
code { font-size: ${fontSize - 2}px; }
`);
	if (lineHeight !== DEFAULT_WECHAT_PRESENTATION.lineHeight) css.push(`
.note-to-mp, h1, h2, h3, h4, h5, h6, p, li, blockquote, table { line-height: ${lineHeight}; }
`);
	if (accent !== DEFAULT_WECHAT_PRESENTATION.accent) css.push(`
h1, h2, h3, h4, h5, h6, a, blockquote { color: ${accent}; }
blockquote { border-left-color: ${accent}; }
`);
	return css.join("\n");
}
