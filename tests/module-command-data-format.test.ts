import { describe, expect, it } from 'vitest';
import {
	DATA_PACKAGE_SCHEMA, DataFormatError, convertBasicFormat, createDataPackage,
	decodeDataPackageFile, encodeDataPackageFile, getConversionSupport,
	parseDataPackage, serializeDataPackage, validateVaultRelativePath,
} from '../src/module-commands/data-format';

function expectCode(action: () => unknown, code: string): void {
	try { action(); throw new Error('Expected rejection'); }
	catch (error) { expect(error).toBeInstanceOf(DataFormatError); expect((error as DataFormatError).code).toBe(code); }
}

describe('portable Vault data paths', () => {
	it('allows relative Chinese paths and normalizes Unicode names', () => {
		expect(validateVaultRelativePath('03-素材/照片/旅行 2026.webp')).toBe('03-素材/照片/旅行 2026.webp');
		expect(validateVaultRelativePath('notes/cafe\u0301.md')).toBe('notes/café.md');
	});
	it.each(['', '/etc/passwd', '../private', 'safe/../private', './safe', 'a//b', 'a/',
		'C:/private', 'C:\\private', '\\\\host\\file', 'file:stream', 'a/\0b', 'a/\nb',
		// Fixed malicious fixture: this must be rejected, never used as a config location.
		// eslint-disable-next-line obsidianmd/hardcoded-config-path
		'a/\u202eb', '.env', '.obsidian/config', 'a/.git/config', 'a/.talos/secret', 'a/node_modules/x',
		'a/%2e%2e/b', 'a/%252e%252e/b', 'a/%2f/b', 'a/%00b', 'a/.%2e/b',
		'a/../b', 'a/．hidden', 'a/．．/b', 'a／..／b', 'CON.txt', 'a/NUL', 'a/aux.json',
		'a/hello.', 'a/ name', 'a/name ', '~/.ssh/id', 'a/\ud800'])('rejects unsafe input %j', path => {
		expectCode(() => validateVaultRelativePath(path), 'unsafe-path');
	});
	it('does not reflect rejected private input in errors', () => {
		try { validateVaultRelativePath('.env/private-value-do-not-show'); }
		catch (error) { expect(String(error)).not.toContain('private-value-do-not-show'); }
	});
});

describe('versioned lossless data packages', () => {
	it('round-trips Chinese, all byte values, empty files, images and video names', () => {
		const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
		const files = [
			encodeDataPackageFile('笔记/你好.md', '# 中文\n😀\r\n'),
			encodeDataPackageFile('素材/图.webp', bytes),
			encodeDataPackageFile('素材/视频.mp4', Uint8Array.of(0, 255, 1, 128, 0)),
			encodeDataPackageFile('素材/空.bin', new Uint8Array()),
			encodeDataPackageFile('笔记/空.txt', ''),
		];
		const result = parseDataPackage(serializeDataPackage(files));
		expect(result).toEqual({ schema: DATA_PACKAGE_SCHEMA, version: 1, files });
		expect(new TextDecoder().decode(decodeDataPackageFile(result.files[0]))).toBe('# 中文\n😀\r\n');
		expect(decodeDataPackageFile(result.files[1])).toEqual(bytes);
		expect(decodeDataPackageFile(result.files[2])).toEqual(Uint8Array.of(0, 255, 1, 128, 0));
		expect(decodeDataPackageFile(result.files[3])).toEqual(new Uint8Array());
	});
	it.each([Uint8Array.of(255), Uint8Array.of(255, 128), Uint8Array.of(255, 128, 1)])('round-trips padding variants', bytes => {
		expect(decodeDataPackageFile(encodeDataPackageFile('x.bin', bytes))).toEqual(bytes);
	});
	it('owns its manifest records rather than mutating callers', () => {
		const file = encodeDataPackageFile('x.md', 'a');
		const packaged = createDataPackage([file]);
		packaged.files[0].content = 'b';
		expect(file.content).toBe('a');
	});
	it.each(['{', 'null', '[]', '{}', '{"schema":"talos.data-package","version":2,"files":[]}',
		'{"schema":"unknown","version":1,"files":[]}',
		'{"schema":"talos.data-package","version":1,"files":[],"unexpected":true}',
		'{"schema":"talos.data-package","version":1,"files":[{"path":"x","encoding":"hex","content":"ff"}]}',
		'{"schema":"talos.data-package","version":1,"files":[{"path":"x","encoding":"text","content":42}]}',
		'{"schema":"talos.data-package","version":1,"files":[{"path":"x","encoding":"text","content":"ok","extra":1}]}',
	])('rejects malformed or unknown package structures', input => {
		expectCode(() => parseDataPackage(input), 'invalid-package');
	});
	it.each(['a', '!!!!', 'Zg=', 'Zg===', 'Z g==', 'Zh==', 'Zm9=', 'AA-_'])('rejects invalid/noncanonical base64', content => {
		expectCode(() => createDataPackage([{ path: 'x.bin', encoding: 'base64', content }]), 'invalid-content');
	});
	it.each([['a.md', 'a.md'], ['A.md', 'a.md'], ['café.md', 'cafe\u0301.md'], ['a', 'a/b'], ['a/b', 'a']])('rejects duplicate or file-directory collisions', (first, second) => {
		expectCode(() => createDataPackage([encodeDataPackageFile(first, ''), encodeDataPackageFile(second, '')]), 'duplicate-path');
	});
	it('validates import paths before returning a package', () => {
		const input = JSON.stringify({ schema: DATA_PACKAGE_SCHEMA, version: 1, files: [{ path: '../private', encoding: 'text', content: 'secret' }] });
		expectCode(() => parseDataPackage(input), 'unsafe-path');
	});
	it('rejects duplicate JSON keys including escaped keys instead of last-key-wins parsing', () => {
		expectCode(() => parseDataPackage('{"schema":"talos.data-package","version":2,"version":1,"files":[]}'), 'invalid-package');
		expectCode(() => parseDataPackage('{"schema":"talos.data-package","version":1,"files":[{"path":"a","p\\u0061th":"b","encoding":"text","content":"x"}]}'), 'invalid-package');
	});
	it('keeps JSON-shaped file text out of duplicate-key inspection', () => {
		const file = encodeDataPackageFile('x.txt', String.raw`{"a":1,"a":2,"quoted":"\""}`);
		expect(parseDataPackage(serializeDataPackage([file])).files).toEqual([file]);
	});
	it('enforces file count and decoded UTF-8/binary totals on both boundaries', () => {
		const files = [encodeDataPackageFile('x.txt', '中文'), encodeDataPackageFile('x.bin', Uint8Array.of(0, 1, 2))];
		expectCode(() => createDataPackage(files, { maxFiles: 1 }), 'limit-exceeded');
		expectCode(() => createDataPackage(files, { maxTotalBytes: 8 }), 'limit-exceeded');
		expect(createDataPackage(files, { maxTotalBytes: 9 }).files).toHaveLength(2);
		expectCode(() => parseDataPackage(serializeDataPackage(files), { maxTotalBytes: 8 }), 'limit-exceeded');
		expectCode(() => parseDataPackage(' '.repeat(101), { maxSerializedBytes: 100 }), 'limit-exceeded');
		expectCode(() => serializeDataPackage(files, { maxSerializedBytes: 20 }), 'limit-exceeded');
		expectCode(() => createDataPackage(files, { maxFiles: Number.NaN }), 'limit-exceeded');
	});
	it('rejects lone surrogates rather than silently changing text bytes', () => {
		expectCode(() => encodeDataPackageFile('x.txt', '\ud800'), 'invalid-content');
	});
});

describe('executable basic local conversion', () => {
	it('extracts basic Markdown as text', () => {
		expect(convertBasicFormat('# 标题\n- **重点**\n[来源](https://example.test)', 'md', 'txt')).toBe('标题\n重点\n来源 (https://example.test)');
	});
	it('makes HTML-shaped Markdown and text inert in HTML output', () => {
		for (const format of ['md', 'txt']) {
			const html = convertBasicFormat('<script>alert(1)</script>\n<img src=x onerror="x">&', format, 'html');
			expect(html).not.toContain('<script>');
			expect(html).not.toContain('<img');
			expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
			expect(html).toContain('default-src \'none\'');
		}
	});
	it('preserves large JSON numbers and prevents fence breakout', () => {
		const json = '{"id":123456789012345678901234567890,"text":"````"}';
		expect(convertBasicFormat(json, 'json', 'txt')).toBe(json);
		expect(convertBasicFormat(json, 'json', 'md')).toBe('`````json\n' + json + '\n`````\n');
		expect(convertBasicFormat('你好', ' .TXT ', 'md')).toContain('你好');
		expectCode(() => convertBasicFormat('{broken', 'json', 'md'), 'invalid-content');
	});
	it('converts quoted CSV with commas, quotes, CRLF, newlines and inert formulas', () => {
		const csv = '名称,内容\r\n甲,"a,b"\r\n乙,"say ""hi""\nnext"\r\n丙,=1+2';
		const md = convertBasicFormat(csv, 'csv', 'md');
		expect(md).toContain('| 甲 | a,b |');
		expect(md).toContain('say &quot;hi&quot;<br>next');
		expect(md).toContain('=1+2');
		expect(convertBasicFormat('a,b\n1,2\n', 'csv', 'txt')).toBe('a\tb\n1\t2');
	});
	it('escapes active markup and separators inside CSV Markdown cells', () => {
		expect(convertBasicFormat('a,b\n<script>,x|y', 'csv', 'md')).toContain('| &lt;script&gt; | x\\|y |');
		expect(convertBasicFormat('a\n![remote](https://example.test/image)', 'csv', 'md'))
			.toContain('\\!\\[remote\\]\\(https://example.test/image\\)');
	});
	it.each(['a,"open', 'a,"closed"bad', 'a,b\n1', 'a,b\n1,2,3'])('rejects malformed CSV', csv => {
		expectCode(() => convertBasicFormat(csv, 'csv', 'md'), 'invalid-content');
	});
	it.each(['pdf', 'docx', 'xlsx', 'pptx', 'png', 'mp4', 'mov', 'unknown'])('does not claim unsupported conversion for %s', format => {
		expect(getConversionSupport(format, 'md')).toEqual({ supported: false, reason: 'unsupported-format' });
		expectCode(() => convertBasicFormat('data', format, 'md'), 'unsupported-format');
	});
	it('rejects unsupported output and invalid or oversized text', () => {
		expectCode(() => convertBasicFormat('data', 'md', 'pdf'), 'unsupported-format');
		expectCode(() => convertBasicFormat('a\0b', 'txt', 'md'), 'invalid-content');
		expectCode(() => convertBasicFormat('x'.repeat(5 * 1024 * 1024 + 1), 'txt', 'md'), 'limit-exceeded');
	});
});
