/**
 * 微信公众号 API 服务
 * 支持代理配置
 */

import { requestUrl, RequestUrlParam } from 'obsidian';
import { ResolvedProxyConfig } from '../types';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as http from 'node:http';
import * as https from 'node:https';

/**
 * 发起带代理的请求
 * 使用 Node.js 原生 http/https 模块确保代理在 Electron 环境中正常工作
 */
async function requestWithProxy(
	url: string,
	options: RequestUrlParam,
	proxyConfig?: ResolvedProxyConfig
): Promise<any> {
	// 如果没有配置代理或未启用,使用默认方式
	if (!proxyConfig || !proxyConfig.host || !proxyConfig.port) {
		const response = await requestUrl(options);
		return {
			status: response.status,
			json: response.json,
			text: response.text
		};
	}

	try {
		// 构建代理 URL 和 agent
		const auth = proxyConfig.username && proxyConfig.password
			? `${encodeURIComponent(proxyConfig.username)}:${encodeURIComponent(proxyConfig.password)}@`
			: "";

		let agent: any;
		if (proxyConfig.type === "socks5") {
			const proxyUrl = `socks5h://${auth}${proxyConfig.host}:${proxyConfig.port}`;
			agent = new SocksProxyAgent(proxyUrl);
		} else {
			const protocol = proxyConfig.type || "http";
			const proxyUrl = `${protocol}://${auth}${proxyConfig.host}:${proxyConfig.port}`;
			agent = new HttpsProxyAgent(proxyUrl);
		}

		// 使用 Node.js 原生 http/https 模块（避免 axios 的 CORS 问题）
		const targetUrl = new URL(options.url || url);
		const isHttps = targetUrl.protocol === 'https:';
		const requestModule = isHttps ? https : http;

		const requestOptions = {
			hostname: targetUrl.hostname,
			port: targetUrl.port || (isHttps ? 443 : 80),
			path: targetUrl.pathname + targetUrl.search,
			method: options.method || 'GET',
			headers: options.headers || {},
			agent: agent
		};

		// 设置 Content-Type
		if (options.contentType) {
			requestOptions.headers['Content-Type'] = options.contentType;
		}

		// 如果有请求体，设置 Content-Length
		if (options.body) {
			if (typeof options.body === 'string') {
				requestOptions.headers['Content-Length'] = Buffer.byteLength(options.body).toString();
			}
		}

		// 发送请求
		return new Promise((resolve, reject) => {
			const req = requestModule.request(requestOptions, (res: any) => {
				let data = '';

				res.on('data', (chunk: any) => {
					data += chunk;
				});

				res.on('end', () => {
					try {
						let jsonData = null;
						try {
							jsonData = JSON.parse(data);
						} catch (e) {
							// 如果不是JSON，保持原样
							jsonData = data;
						}

						resolve({
							status: res.statusCode,
							headers: res.headers,
							text: data,
							json: jsonData
						});
					} catch (error) {
						reject(error);
					}
				});
			});

			req.on('error', (error: Error) => {
				reject(error);
			});

			// 如果有请求体，写入
			if (options.body) {
				req.write(options.body);
			}

			req.end();
		});

	} catch (error: any) {
		// 不要 fallback 到直连，直接抛出错误
		// 这样用户才知道代理配置有问题
		throw new Error('代理请求失败');
	}
}


/**
 * 微信接口错误：保留 errcode，并把常见错误码翻译成中文提示
 */
export class WeixinApiError extends Error {
	errcode: number | string;
	constructor(message: string, errcode: number | string) {
		super(message);
		this.name = 'WeixinApiError';
		this.errcode = errcode;
	}
}

const WEIXIN_ERROR_HINTS: Record<string, string> = {
	'40001': 'Access Token 无效或 AppSecret 错误',
	'40013': 'AppID 无效，请检查账号设置',
	'40125': 'AppSecret 无效，请到「微信开发者平台 → 我的业务与服务 → 公众号 → 基础信息」重置后重新填写',
	'40164': '当前出口 IP 不在公众号 IP 白名单',
	'42001': 'Access Token 已过期',
	'48001': '该公众号没有此接口权限（未认证的个人号常见），请到「微信开发者平台 → 公众号 → 接口管理」确认「草稿箱 / 素材管理」可用',
	'45009': '今日接口调用次数已达上限，请明天再试',
	'40007': '封面素材无效，请重新选择封面',
	'40009': '图片尺寸或大小不符合要求',
	'41005': '缺少图片数据',
	'45003': '标题过长',
	'45004': '摘要过长（最多 120 字）',
	'45110': '作者名过长（最多 8 个字）',
	'53404': '账号已被限制发文',
	'-1': '微信系统繁忙，请稍后重试'
};

export function toWeixinError(json: any, fallback: string): WeixinApiError {
	const errcode = json?.errcode ?? 'unknown';
	const errmsg: string = json?.errmsg || fallback;
	let hint = WEIXIN_ERROR_HINTS[String(errcode)];
	if (String(errcode) === '40164') {
		const ip = errmsg.match(/invalid ip ([0-9a-fA-F.:]+)/)?.[1];
		hint = ip
			? `出口 IP ${ip} 不在公众号白名单。请到「微信开发者平台 → 我的业务与服务 → 公众号 → 基础信息」页的「开发密钥 → API IP 白名单」里，把 ${ip} 加进去，几分钟后再试（家庭宽带 IP 变化后需要重新添加）`
			: `${hint}，请到「微信开发者平台 → 我的业务与服务 → 公众号 → 基础信息」页的「开发密钥 → API IP 白名单」里，把当前出口 IP 加进去`;
	}
	const message = hint ? `${hint}（errcode: ${errcode}）` : `${errmsg}（errcode: ${errcode}）`;
	return new WeixinApiError(message, errcode);
}

/**
 * 获取 Access Token
 */
export async function getAccessToken(appid: string, secret: string, proxyConfig?: ResolvedProxyConfig): Promise<string> {
	const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;

	try {
		const response = await requestWithProxy(url, {
			url,
			method: 'GET',
			throw: false
		}, proxyConfig);

		if (response.json.access_token) {
			return response.json.access_token;
		} else {
			throw toWeixinError(response.json, '获取 Access Token 失败');
		}
	} catch (error) {
		throw error;
	}
}

/**
 * 手动构建 multipart/form-data 请求体
 * （不用 form-data 包：esbuild 打包时会换成浏览器版 FormData，导致上传报错）
 */
function buildMultipart(fieldName: string, data: Buffer, filename: string, contentType: string) {
	const boundary = '----SerenaPost' + Date.now().toString(16) + Math.random().toString(16).slice(2);
	const head = Buffer.from(
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
		`Content-Type: ${contentType}\r\n\r\n`,
		'utf8'
	);
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
	const body = Buffer.concat([head, data, tail]);
	return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function detectImageType(buf: Buffer, filename: string): string {
	if (buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
	if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
	if (buf.length > 2 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
	return /\.png$/i.test(filename) ? 'image/png' : 'image/jpeg';
}

/**
 * 上传图片素材
 */
export async function uploadImage(
	imageData: ArrayBuffer,
	filename: string,
	accessToken: string,
	proxyConfig?: ResolvedProxyConfig
): Promise<{ media_id: string; url: string }> {
	const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=image`;
	const buffer = Buffer.from(imageData);
	const mime = detectImageType(buffer, filename);
	const ext = mime === 'image/png' ? 'png' : mime === 'image/gif' ? 'gif' : 'jpg';
	const safeName = filename.replace(/\.[^.]+$/, '') + '.' + ext;
	const { body, contentType } = buildMultipart('media', buffer, safeName, mime);

	let json: any;
	if (!proxyConfig || !proxyConfig.host || !proxyConfig.port) {
		// 与获取 Token 走同一条网络（Obsidian requestUrl），出口 IP 一致
		const arrayBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
		const response = await requestUrl({ url, method: 'POST', contentType, body: arrayBuffer, throw: false });
		json = response.json;
	} else {
		const response = await requestWithProxy(url, {
			url,
			method: 'POST',
			contentType,
			headers: { 'Content-Length': String(body.length) },
			body: body as any
		}, proxyConfig);
		json = response.json;
	}

	if (json && json.media_id) return json;
	throw toWeixinError(json, '上传图片失败');
}

/**
 * 创建草稿
 */
export async function addDraft(
	articles: any[],
	accessToken: string,
	proxyConfig?: ResolvedProxyConfig
): Promise<{ media_id: string }> {
	const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`;

	try {
		const response = await requestWithProxy(url, {
			url,
			method: 'POST',
			contentType: 'application/json',
			body: JSON.stringify({ articles }),
			throw: false
		}, proxyConfig);

		if (!response || !response.json) {
			throw new Error('API 返回数据格式错误');
		}

		if (response.json.media_id) {
			return response.json;
		} else {
			throw toWeixinError(response.json, '创建草稿失败');
		}
	} catch (error) {
		throw error;
	}
}

/**
 * 检查草稿箱接口权限（只读：取草稿列表第一条，不会创建任何东西）。
 * 未认证的个人号常见 48001：没有草稿箱 / 素材管理权限。
 */
export async function checkDraftPermission(
	accessToken: string,
	proxyConfig?: ResolvedProxyConfig
): Promise<{ ok: boolean; errcode?: string; message?: string }> {
	const url = `https://api.weixin.qq.com/cgi-bin/draft/batchget?access_token=${accessToken}`;
	const response = await requestWithProxy(url, {
		url,
		method: 'POST',
		contentType: 'application/json',
		body: JSON.stringify({ offset: 0, count: 1, no_content: 1 })
	}, proxyConfig);
	const json = response?.json;
	const code = json?.errcode;
	if (code === undefined || code === 0) return { ok: true };
	return { ok: false, errcode: String(code), message: toWeixinError(json, '检查接口权限失败').message };
}

/**
 * 测试代理连接并返回实际出口IP
 */
export async function testProxy(proxyConfig: ResolvedProxyConfig): Promise<{ success: boolean; latency?: number; error?: string; actualIP?: string }> {
	const startTime = Date.now();

	try {
		// 先检查实际出口IP
		const ipCheckResponse = await requestWithProxy('https://api.ipify.org?format=json', {
			url: 'https://api.ipify.org?format=json',
			method: 'GET'
		}, proxyConfig);

		const actualIP = ipCheckResponse.json?.ip || 'unknown';
		// 再测试访问微信API
		await requestWithProxy('https://api.weixin.qq.com', {
			url: 'https://api.weixin.qq.com',
			method: 'GET'
		}, proxyConfig);

		const latency = Date.now() - startTime;

		return {
			success: true,
			latency,
			actualIP
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : '代理连接失败'
		};
	}
}

/**
 * 仅检查当前代理的实际出口IP
 */
export async function checkProxyIP(proxyConfig?: ResolvedProxyConfig): Promise<string> {
	try {
		const response = await requestWithProxy('https://api.ipify.org?format=json', {
			url: 'https://api.ipify.org?format=json',
			method: 'GET'
		}, proxyConfig);

		const ip = response.json?.ip || 'unknown';
		return ip;
	} catch (error) {
		return 'unknown';
	}
}
