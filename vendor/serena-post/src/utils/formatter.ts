import { applyInlineCSS } from './css-to-inline';
import { marked } from 'marked';
import { sanitizeHTMLToDom } from 'obsidian';
import { headingStyleDef } from './heading-styles';

// TALOS integration: Markdown labels must not introduce resource attributes.
function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert Markdown to WeChat Official Account HTML format
 * This is a simplified version - for production, consider using a dedicated library
 */
export class WeChatFormatter {
	/**
	 * Convert markdown to WeChat-compatible HTML with optional custom CSS
	 */
	static markdownToHtml(markdown: string, customCSS?: string): string {
		let html = markdown;

		// Headers
		html = html.replace(/^### (.*$)/gim, '<h3 style="margin: 1.2em 0 1em; font-size: 16px; font-weight: bold; color: #333;">$1</h3>');
		html = html.replace(/^## (.*$)/gim, '<h2 style="margin: 1.2em 0 1em; font-size: 18px; font-weight: bold; color: #333;">$1</h2>');
		html = html.replace(/^# (.*$)/gim, '<h1 style="margin: 1.2em 0 1em; font-size: 20px; font-weight: bold; color: #333;">$1</h1>');

		// Bold
		html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight: bold; color: #333;">$1</strong>');
		html = html.replace(/__(.*?)__/g, '<strong style="font-weight: bold; color: #333;">$1</strong>');

		// Italic
		html = html.replace(/\*(.*?)\*/g, '<em style="font-style: italic;">$1</em>');
		html = html.replace(/_(.*?)_/g, '<em style="font-style: italic;">$1</em>');

		// Inline code
		html = html.replace(/`([^`]+)`/g, '<code style="padding: 2px 4px; font-size: 90%; color: #c7254e; background-color: #f9f2f4; border-radius: 3px; font-family: Menlo, Monaco, Consolas, monospace;">$1</code>');

		// Code blocks
		html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
			return `<pre style="padding: 16px; overflow: auto; font-size: 14px; line-height: 1.45; background-color: #f6f8fa; border-radius: 6px; margin: 1em 0;"><code style="font-family: Menlo, Monaco, Consolas, monospace; color: #333;">${this.escapeHtml(code.trim())}</code></pre>`;
		});

		// Images (MUST be before Links because ![...](...) contains [...](...))
		html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; height: auto; display: block; margin: 1em auto;" />');

		// Links
		html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #576b95; text-decoration: none;">$1</a>');

		// Blockquotes
		html = html.replace(/^> (.*$)/gim, '<blockquote style="margin: 1em 0; padding: 0 0 0 1em; border-left: 4px solid #d0d0d0; color: #666;">$1</blockquote>');

		// Unordered lists
		html = html.replace(/^\* (.*$)/gim, '<li style="margin: 0.5em 0; line-height: 1.6;">$1</li>');
		html = html.replace(/^- (.*$)/gim, '<li style="margin: 0.5em 0; line-height: 1.6;">$1</li>');

		// Wrap consecutive list items in ul
		html = html.replace(/(<li[^>]*>.*<\/li>\s*)+/g, (match) => {
			return `<ul style="margin: 1em 0; padding-left: 2em; list-style-type: disc;">${match}</ul>`;
		});

		// Ordered lists
		html = html.replace(/^\d+\. (.*$)/gim, '<li style="margin: 0.5em 0; line-height: 1.6;">$1</li>');

		// Wrap consecutive ordered list items in ol
		html = html.replace(/(<li[^>]*>.*<\/li>\s*)+/g, (match) => {
			if (!match.includes('<ul')) {
				return `<ol style="margin: 1em 0; padding-left: 2em; list-style-type: decimal;">${match}</ol>`;
			}
			return match;
		});

		// Horizontal rules
		html = html.replace(/^---$/gim, '<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 2em 0;" />');

		// Paragraphs - split by double newlines
		const paragraphs = html.split(/\n\n+/);
		html = paragraphs.map(p => {
			// Don't wrap if already wrapped in a block element
			if (p.match(/^<(h[1-6]|ul|ol|pre|blockquote|hr)/)) {
				return p;
			}
			// Don't wrap empty strings
			if (!p.trim()) {
				return '';
			}
			return `<p style="margin: 1em 0; line-height: 1.75; font-size: 15px; color: #333;">${p.trim()}</p>`;
		}).join('\n');

		// Wrap everything in a container with WeChat-friendly styles
		html = `
<section class="note-to-mp" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; color: #333; line-height: 1.75; word-wrap: break-word; word-break: break-word;">
${html}
</section>`.trim();

		// Apply custom CSS as inline styles if provided
		if (customCSS) {
			try {
				html = applyInlineCSS(html, customCSS);
			} catch (error) {
				console.error('Failed to apply inline CSS:', error);
				// If CSS application fails, return HTML without custom styles
			}
		}

		return html;
	}

	/**
	 * Escape HTML special characters
	 */
	private static escapeHtml(text: string): string {
		const map: { [key: string]: string } = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#039;'
		};
		return text.replace(/[&<>"']/g, m => map[m]);
	}

	/**
	 * Generate preview HTML (for display in Obsidian)
	 */
	static generatePreview(html: string): string {
		return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>WeChat Preview</title>
	<style>
		body {
			max-width: 677px;
			margin: 0 auto;
			padding: 20px;
			background-color: #f5f5f5;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
		}
		.preview-container {
			background-color: white;
			padding: 20px;
			border-radius: 8px;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		}
	</style>
</head>
<body>
	<div class="preview-container">
		${html}
	</div>
</body>
</html>`.trim();
	}

	/**
	 * Process Obsidian image links
	 */
	static processObsidianImages(content: string, vault: any): string {
		// Replace ![[image.png]] with standard markdown ![](image.png)
		return content.replace(/!\[\[([^\]]+)\]\]/g, (match, filename) => {
			// Try to find the file in the vault
			const file = vault.getAbstractFileByPath(filename);
			if (file) {
				// For now, just convert to standard markdown
				// In production, you'd upload the image and get a URL
				return `![${filename}](${filename})`;
			}
			return match;
		});
	}
}

/**
 * MarkedFormatter - Uses marked.js for professional Markdown parsing
 * This provides better handling of code blocks, blockquotes, and other complex Markdown elements
 */
export interface FormatterOptions {
	headingLabel?: string;
	/** 二级标题只加「01」序号（不带文字前缀） */
	headingNumbers?: boolean;
	/** 代码块加 Mac 窗口标题栏（三个圆点 + 语言） */
	codeWindow?: boolean;
	/** 章节样式（覆盖排版自带的二级标题样式），见 heading-styles.ts */
	headingStyle?: string;
	/** 二级标题前放的 IP 头像（data URL） */
	headingAvatar?: string;
	/** 文末标记文字，例如「SERENA · END」 */
	endMark?: string;
}

export class MarkedFormatter {
	private static markedInstance: typeof marked | null = null;

	/**
	 * Initialize marked with WeChat-friendly renderer
	 */
	private static initMarked(): typeof marked {
		if (this.markedInstance) {
			return this.markedInstance;
		}

		this.markedInstance = marked;

		// Configure marked options
		marked.setOptions({
			gfm: true,
			breaks: true,
			pedantic: false,
		});

		// Custom renderer for WeChat styles
		const renderer = new marked.Renderer();

		// Headings - no inline styles, just semantic tags
		renderer.heading = (text: string, level: number) => {
			return `<h${level}>${text}</h${level}>`;
		};

		// Paragraphs - no inline styles
		renderer.paragraph = (text: string) => {
			return `<p>${text}</p>`;
		};

		// Code blocks - wrap in code-section for CSS styling
		renderer.code = (code: string, language: string | undefined) => {
			const escapedCode = code
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#039;');

			// Split into lines for line number support
			const lines = escapedCode.split('\n');
			let codeBody = '';
			let liItems = '';

			for (let i = 0; i < lines.length; i++) {
				let text = lines[i];
				if (text.length === 0) {
					text = '<br>';
				}
				codeBody += `<code>${text}</code>`;
				liItems += `<li>${i + 1}</li>`;
			}

			const lang = language || '';
			const langClass = lang ? `language-${lang}` : '';

			// Wrap in code-section like wx-draft-auto for CSS compatibility
			return `<section class="code-section ${langClass}"><pre>${codeBody}</pre></section>`;
		};

		// Inline code - no inline styles
		renderer.codespan = (code: string) => {
			return `<code>${code}</code>`;
		};

		// Blockquotes - no inline styles
		renderer.blockquote = (quote: string) => {
			return `<blockquote>${quote}</blockquote>`;
		};

		// Lists - no inline styles
		renderer.list = (body: string, ordered: boolean) => {
			const tag = ordered ? 'ol' : 'ul';
			return `<${tag}>${body}</${tag}>`;
		};

		renderer.listitem = (text: string) => {
			return `<li>${text}</li>`;
		};

		// Links - no inline styles
		renderer.link = (href: string, title: string | null | undefined, text: string) => {
			return `<a href="${escapeAttribute(href)}">${text}</a>`;
		};

		// Images - no inline styles
		renderer.image = (href: string, title: string | null | undefined, text: string) => {
			return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(text || '')}" />`;
		};

		// Strong (bold) - no inline styles
		renderer.strong = (text: string) => {
			return `<strong>${text}</strong>`;
		};

		// Emphasis (italic) - no inline styles
		renderer.em = (text: string) => {
			return `<em>${text}</em>`;
		};

		// Horizontal rule - no inline styles
		renderer.hr = () => {
			return `<hr />`;
		};

		marked.use({ renderer });

		// Obsidian 高亮 ==文字==：用 span，避免公众号编辑器过滤 <mark>
		marked.use({
			extensions: [{
				name: 'spMark',
				level: 'inline',
				start(src: string) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
				tokenizer(this: any, src: string) {
					const m = /^==(?=\S)([^=\n]*?\S)==/.exec(src);
					if (m) return { type: 'spMark', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
					return undefined;
				},
				renderer(this: any, token: any) {
					return `<span class="sp-mark">${this.parser.parseInline(token.tokens)}</span>`;
				}
			}]
		});

		return this.markedInstance;
	}

	/**
	 * Convert markdown to WeChat-compatible HTML with optional custom CSS
	 */
	static async markdownToHtml(markdown: string, customCSS?: string, options: FormatterOptions = {}): Promise<string> {
		const markedLib = this.initMarked();

		// Parse markdown to HTML
		let html = await markedLib.parse(markdown) as string;

		// Wrap everything in a container with WeChat-friendly styles
		html = `
<section class="note-to-mp" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; color: #333; line-height: 1.75; word-wrap: break-word; word-break: break-word;">
${html}
</section>`.trim();
		html = this.decorateHeadings(html, options);
		if (options.codeWindow) html = this.decorateCodeWindows(html);

		// Apply custom CSS as inline styles if provided
		if (customCSS) {
			try {
				html = applyInlineCSS(html, customCSS);
			} catch (error) {
				console.error('Failed to apply inline CSS:', error);
				// If CSS application fails, return HTML without custom styles
			}
		}

		return this.sanitize(html);
	}

	/**
	 * Synchronous version for compatibility (uses cached parsing if possible)
	 */
	static markdownToHtmlSync(markdown: string, customCSS?: string, options: FormatterOptions = {}): string {
		const markedLib = this.initMarked();

		// Use synchronous parse
		let html = markedLib.parse(markdown, { async: false }) as string;

		// Wrap everything in a container with WeChat-friendly styles
		html = `
<section class="note-to-mp" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; color: #333; line-height: 1.75; word-wrap: break-word; word-break: break-word;">
${html}
</section>`.trim();
		html = this.decorateHeadings(html, options);
		if (options.codeWindow) html = this.decorateCodeWindows(html);

		// Apply custom CSS as inline styles if provided
		if (customCSS) {
			try {
				html = applyInlineCSS(html, customCSS);
			} catch (error) {
				console.error('Failed to apply inline CSS:', error);
			}
		} else {
			// If no custom CSS, apply default inline styles
			html = this.applyDefaultStyles(html);
		}

		return this.sanitize(html);
	}

	/**
	 * Apply default inline styles when no custom CSS is provided
	 */
	private static applyDefaultStyles(html: string): string {
		const defaultCSS = `
h1 { margin: 1.2em 0 1em; font-size: 20px; font-weight: bold; color: #333; }
h2 { margin: 1.2em 0 1em; font-size: 18px; font-weight: bold; color: #333; }
h3 { margin: 1.2em 0 1em; font-size: 16px; font-weight: bold; color: #333; }
h4 { margin: 1.2em 0 1em; font-size: 15px; font-weight: bold; color: #333; }
h5 { margin: 1.2em 0 1em; font-size: 14px; font-weight: bold; color: #333; }
h6 { margin: 1.2em 0 1em; font-size: 14px; font-weight: bold; color: #333; }
p { margin: 1em 0; line-height: 1.75; font-size: 15px; color: #333; }
pre { padding: 16px; overflow: auto; font-size: 14px; line-height: 1.45; background-color: #f6f8fa; border-radius: 6px; margin: 1em 0; }
code { font-family: Menlo, Monaco, Consolas, monospace; }
pre code { color: #333; }
p code, li code { padding: 2px 4px; font-size: 90%; color: #c7254e; background-color: #f9f2f4; border-radius: 3px; }
blockquote { margin: 1em 0; padding: 0 0 0 1em; border-left: 4px solid #d0d0d0; color: #666; }
ul { margin: 1em 0; padding-left: 2em; list-style-type: disc; }
ol { margin: 1em 0; padding-left: 2em; list-style-type: decimal; }
li { margin: 0.5em 0; line-height: 1.6; }
a { color: #576b95; text-decoration: none; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
strong { font-weight: bold; color: #333; }
em { font-style: italic; }
hr { border: none; border-top: 1px solid #e0e0e0; margin: 2em 0; }
`;
		try {
			return applyInlineCSS(html, defaultCSS);
		} catch (error) {
			console.error('Failed to apply default styles:', error);
			return html;
		}
	}

	private static decorateHeadings(html: string, options: FormatterOptions): string {
		const headingLabel = options.headingLabel?.trim();
		const style = headingStyleDef(options.headingStyle);
		const avatar = options.headingAvatar;
		const endMark = options.endMark?.trim();
		if (!headingLabel && !options.headingNumbers && !style && !avatar && !endMark) return html;

		const container = document.createElement('div');
		container.append(sanitizeHTMLToDom(html));
		const headings = Array.from(container.querySelectorAll('h2'));
		for (const [index, heading] of headings.entries()) {
			const label = document.createElement('span');
			label.className = 'wechatpb-heading-label';
			if (style) {
				heading.classList.add('sp-h', `sp-h-${style.id}`);
				if (style.numbered) {
					const own = stripHeadingNumber(heading);
					label.textContent = String(own ?? index + 1).padStart(2, '0');
				} else if (style.prefix) {
					label.textContent = style.prefix;
					if (style.id === 'dots') {
						const dot2 = document.createElement('span');
						dot2.className = 'sp-h-dot2';
						dot2.textContent = '●';
						label.prepend(dot2);
					}
				}
				if (style.suffix) {
					const suffix = document.createElement('span');
					suffix.className = 'sp-h-suffix';
					suffix.textContent = style.suffix;
					heading.append(suffix);
				}
				if (label.textContent) heading.prepend(label);
			} else if (headingLabel || options.headingNumbers) {
				// 标题自己带了「一、」「1.」「第一章」之类的序号：去掉它，并沿用它的数字，避免出现「01 一、」
				const own = stripHeadingNumber(heading);
				const num = String(own ?? index + 1).padStart(2, '0');
				label.textContent = headingLabel ? `${headingLabel} ${num}` : num;
				heading.prepend(label);
			}
			if (avatar) {
				const img = document.createElement('img');
				img.className = 'sp-h-avatar';
				img.src = avatar;
				img.alt = '';
				// 标题文字（含序号）包一层，排版可以只给文字加下划线、不连头像一起划
				const text = document.createElement('span');
				text.className = 'sp-h-text';
				text.append(...Array.from(heading.childNodes));
				heading.append(img, text);
				heading.classList.add('sp-has-avatar');
			}
		}

		if (endMark) {
			const root = container.querySelector('section.note-to-mp') ?? container;
			const end = document.createElement('section');
			end.className = 'sp-end';
			const text = document.createElement('span');
			text.className = 'sp-end-text';
			text.textContent = endMark;
			end.append(text);
			root.append(end);
		}
		return container.innerHTML;
	}

	/** 给每个代码块加 Mac 窗口标题栏 */
	private static decorateCodeWindows(html: string): string {
		const container = document.createElement('div');
		container.append(sanitizeHTMLToDom(html));
		for (const section of Array.from(container.querySelectorAll('section.code-section'))) {
			const lang = Array.from(section.classList).find(c => c.startsWith('language-'))?.slice(9) ?? '';
			const bar = document.createElement('section');
			bar.className = 'code-window-bar';
			for (let i = 1; i <= 3; i++) {
				const dot = document.createElement('span');
				dot.className = `code-window-dot code-window-dot-${i}`;
				dot.textContent = '●';
				bar.append(dot);
			}
			const label = document.createElement('span');
			label.className = 'code-window-label';
			label.textContent = (lang || 'code').toUpperCase();
			bar.append(label);
			section.prepend(bar);
		}
		return container.innerHTML;
	}

	static sanitize(html: string): string {
		const container = document.createElement('div');
		container.append(sanitizeHTMLToDom(html));
		return container.innerHTML;
	}
}

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 中文数字（一 ~ 九十九）转数字 */
export function parseCnNumber(s: string): number | null {
	if (/^\d+$/.test(s)) return parseInt(s, 10);
	if (!/^[零〇一二两三四五六七八九十]+$/.test(s)) return null;
	if (!s.includes('十')) return s.length === 1 ? CN_DIGITS[s] : null;
	const [a, b] = s.split('十');
	const tens = a === '' ? 1 : CN_DIGITS[a];
	const ones = b === '' ? 0 : CN_DIGITS[b];
	if (tens === undefined || ones === undefined || s.split('十').length > 2) return null;
	return tens * 10 + ones;
}

// 「一、」「一.」「(一)」「第一章 / 第1部分」「1.」「1、」「1）」「01 」（「5 个技巧」这种不算序号）
const HEADING_NUM_RE = /^\s*(?:第\s*([零〇一二两三四五六七八九十\d]+)\s*[章节部分篇步讲课回]+[、.．:：\s]*|[（(]\s*([零〇一二两三四五六七八九十\d]+)\s*[)）]\s*|([零〇一二两三四五六七八九十]+)\s*[、.．:：]\s*|(\d{1,2})\s*[、.．:：)）](?!\d)\s*|(0\d)\s+)/;

/** 去掉标题开头自带的序号，返回该序号；没有则返回 null（不改动标题） */
export function stripHeadingNumber(heading: Element): number | null {
	const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode() as Text | null;
	while (node && !node.data.trim()) node = walker.nextNode() as Text | null;
	if (!node) return null;
	const m = node.data.match(HEADING_NUM_RE);
	if (!m) return null;
	const n = parseCnNumber(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]);
	if (n === null || n <= 0) return null;
	const rest = node.data.slice(m[0].length);
	if (!rest.trim() && node === heading.lastChild) return null; // 标题只有序号本身就不动
	node.data = rest;
	return n;
}
