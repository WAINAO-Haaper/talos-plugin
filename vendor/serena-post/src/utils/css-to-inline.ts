import * as postcss from 'postcss';
import { sanitizeHTMLToDom } from 'obsidian';

/**
 * Apply CSS rules to HTML elements as inline styles
 * Based on wx-draft-auto implementation
 */
export function applyInlineCSS(html: string, css: string): string {
	// Create a temporary container
	const tempDiv = document.createElement('div');
	tempDiv.append(sanitizeHTMLToDom(html));
	const root = tempDiv.firstElementChild as HTMLElement;

	if (!root) {
		return html;
	}

	// Parse CSS
	const cssRoot = postcss.parse(css);

	// Apply styles recursively
	applyStyleToElement(root, cssRoot);

	return root.outerHTML;
}

function applyStyleToElement(element: HTMLElement, cssRoot: postcss.Root) {
	// Skip SVG elements
	if (element.tagName.toLowerCase() === 'svg') {
		return;
	}

	// Get existing inline styles
	const existingStyles = element.style.cssText;

	// Walk through CSS rules
	cssRoot.walkRules((rule) => {
		// Responsive and other at-rules cannot survive WeChat's inline-style paste.
		// Ignoring them is safer than applying mobile overrides unconditionally.
		if (hasAtRuleParent(rule)) return;
		const selector = processPseudoSelector(rule.selector);

		try {
			// Check if this element matches the selector
			if (element.matches(selector)) {
				let targetElement = element;

				// Handle pseudo elements (::before, ::after)
				const pseudoType = getPseudoType(rule.selector);
				if (pseudoType) {
					const span = document.createElement('span');

					// Get content value
					rule.walkDecls('content', (decl) => {
						const content = decl.value.replace(/(^")|("$)/g, '');
						span.textContent = content;
					});

					if (pseudoType === 'before') {
						element.prepend(span);
					} else if (pseudoType === 'after') {
						element.appendChild(span);
					}

					targetElement = span;
				}

				// Apply each declaration
				rule.walkDecls((decl) => {
					// Skip 'content' property as it's already handled
					if (decl.prop === 'content') {
						return;
					}

					// Custom CSS always overrides (unless the existing style has higher specificity)
					// We allow custom CSS to override because users expect their theme to work
					targetElement.style.setProperty(decl.prop, decl.value, decl.important ? 'important' : '');
				});
			}
		} catch (err: unknown) {
			// Ignore invalid selector errors
			if (err instanceof Error && err.message.includes('is not a valid selector')) {
				return;
			}
			console.warn('CSS selector error:', err);
		}
	});

	// Recursively apply to children
	let child = element.firstElementChild;
	while (child) {
		applyStyleToElement(child as HTMLElement, cssRoot);
		child = child.nextElementSibling;
	}
}

function hasAtRuleParent(rule: postcss.Rule): boolean {
	let parent: postcss.Node | undefined = rule.parent;
	while (parent) {
		if (parent.type === 'atrule') return true;
		parent = parent.parent;
	}
	return false;
}

/**
 * Remove pseudo selectors from selector string
 */
function processPseudoSelector(selector: string): string {
	return selector
		.replace(/::before/g, '')
		.replace(/::after/g, '');
}

/**
 * Get pseudo element type from selector
 */
function getPseudoType(selector: string): 'before' | 'after' | undefined {
	if (selector.includes('::before')) {
		return 'before';
	} else if (selector.includes('::after')) {
		return 'after';
	}
	return undefined;
}
