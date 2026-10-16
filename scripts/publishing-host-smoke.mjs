/** Render the real modal in a browser with synthetic host data; never send network requests. */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const output = join(tmpdir(), 'talos-publishing-ui-smoke');
await mkdir(output, { recursive: true });
const obsidian = `
function make(tag,options={}){const el=document.createElement(tag);if(options.text!==undefined)el.textContent=options.text;if(options.cls)el.className=options.cls;for(const [k,v] of Object.entries(options.attr||{}))el.setAttribute(k,v);if(options.value)el.value=options.value;this.appendChild(el);return el}
HTMLElement.prototype.createEl=make;HTMLElement.prototype.createDiv=function(o){return make.call(this,'div',typeof o==='string'?{cls:o}:o)};HTMLElement.prototype.createSpan=function(o){return make.call(this,'span',o)};HTMLElement.prototype.empty=function(){this.replaceChildren()};HTMLElement.prototype.setText=function(t){this.textContent=t};HTMLElement.prototype.addClass=function(...c){this.classList.add(...c)};
export class Modal{constructor(app){this.app=app;this.modalEl=document.body.createDiv({cls:'modal'});this.header=this.modalEl.createEl('h2');this.contentEl=this.modalEl.createDiv({cls:'modal-content'});}setTitle(t){this.header.textContent=t}open(){this.onOpen()}close(){this.onClose();this.modalEl.remove()}}
export class Notice{constructor(t){document.querySelector('#notice').textContent=t}}
export function sanitizeHTMLToDom(html){return document.createRange().createContextualFragment(html)}
export const TFile=class {};export const requestUrl=()=>{throw new Error('Network forbidden in synthetic preview')};
`;
const entry = `
import {PublishingModal} from './src/publishing/modal.ts';
globalThis.Buffer={from:(bytes)=>({toString:()=>btoa(String.fromCharCode(...bytes))})};
const accounts=[{id:'wx-demo',platform:'wechat',label:'示例公众号',appId:'wx1234567890123456'},{id:'x-demo',platform:'x',label:'@example',xAccount:'example'}];
const records=[];let article;
const app={workspace:{getActiveFile:()=>({path:'文章/内容发布示例.md',basename:'内容发布示例',extension:'md'})}};
const host={plugin:{app},listNotes:()=>[{path:'文章/内容发布示例.md'}],loadConfig:async()=>({accounts}),records:async()=>records,copyRelayToken:async()=>{},saveAccounts:async()=>{},cancel:()=>{},
prepare:async(input)=>article={...input,markdown:'示例正文',wechatHtml:'<section><h1>把文章送到两个草稿箱</h1><p>这是一篇用于界面验收的合成文章。</p><h2>一、检查内容</h2><p>标题、图片和段落已固定为本次快照。</p><blockquote>平台草稿与公开发布分开记录。</blockquote><table><tr><th>平台</th><th>结果</th></tr><tr><td>公众号</td><td>等待确认</td></tr><tr><td>X</td><td>等待确认</td></tr></table></section>',xMarkdown:'# 把文章送到两个草稿箱\\n\\n这是一篇用于界面验收的合成文章。\\n\\n## 一、检查内容\\n\\n**标题、图片和段落**已固定为本次快照。\\n\\n> 平台草稿与公开发布分开记录。'.replaceAll('\\\\n','\\n'),assets:[],wechatAssets:[],warnings:['公众号需要补充视频时，会保留明确占位提示。'],fingerprint:'9ea047d05ae5-synthetic',createdAt:new Date().toISOString(),cover:{source:'cover.png',fileName:'cover.png',mime:'image/png',bytes:Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9V0AAAAASUVORK5CYII='),c=>c.charCodeAt(0)),sha256:'synthetic'}},
proposal:async(a,ids)=>({id:'synthetic-approval',article:a,accounts:accounts.filter(x=>ids.includes(x.id))}),
confirm:async()=>{throw new Error('合成预览禁止真实发送。请在 Obsidian 中配置账号后验收。')},reconcile:async()=>{throw new Error('合成预览没有远端草稿')}};
new PublishingModal(app,host).open();
`;
await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'publishing-smoke.ts' }, bundle: true, format: 'iife', outfile: join(output, 'app.js'), platform: 'browser', plugins: [{ name: 'synthetic-host', setup(b) {
	b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'synthetic' }));
	b.onLoad({ filter: /.*/, namespace: 'synthetic' }, () => ({ contents: obsidian, loader: 'js' }));
	b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: 'crypto', namespace: 'offline-crypto' }));
	b.onLoad({ filter: /.*/, namespace: 'offline-crypto' }, () => ({ contents: 'export const createHash=()=>{throw new Error("Not used by modal smoke")}', loader: 'js' }));
} }] });
const css = await readFile(join(root, 'styles.ui-v2.css'), 'utf8');
await writeFile(join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TALOS 草稿工作区 · 合成验收</title><style>:root{--background-modifier-border:#c9cdd4;--text-muted:#606874;--text-warning:#916b12;font:15px/1.6 system-ui;color:#20242a;background:#e8ebee}*{box-sizing:border-box}body{margin:0;padding:24px}#banner{max-width:1100px;margin:0 auto 14px;padding:10px 14px;background:#fff2ca;border-radius:6px}.modal{margin:auto;background:white;border-radius:12px;padding:22px;box-shadow:0 8px 30px #0001}input{border:1px solid #c9cdd4;padding:9px;border-radius:5px;font:inherit}input[type=checkbox]{width:auto}button{font:inherit;border:1px solid #c9cdd4;background:#f6f7f8;border-radius:5px;padding:8px 14px;cursor:pointer}.mod-cta{background:#245cba;color:white}button:disabled{opacity:.45;cursor:default}h2,h3,p{margin:8px 0}.setting-item-description{color:var(--text-muted)}${css}</style><div id="banner">合成界面验收 · 真实 TALOS 界面代码，模拟 Obsidian 宿主；不会发送文章或使用真实账号。</div><div id="notice"></div><script src="app.js"></script></html>`);
console.log(`Prepared synthetic modal at ${output}`);
if (process.argv.includes('--serve')) {
	const server = createServer(async (req, res) => {
		const name = req.url === '/app.js' ? 'app.js' : 'index.html';
		res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
		res.end(await readFile(join(output, name)));
	});
	server.listen(8876, '127.0.0.1', () => console.log('Synthetic preview http://127.0.0.1:8876'));
}
