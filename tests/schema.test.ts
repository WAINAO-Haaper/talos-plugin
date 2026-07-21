import { describe, expect, it } from "vitest";
import {
	CONTENT_KEYS,
	MODULE_KEYS,
	SCHEMA_PRESET_CN,
	SCHEMA_PRESET_EN,
	VaultPaths,
	resolveSchema,
} from "../src/data/schema";

describe("resolveSchema", () => {
	it("无覆盖时返回中文默认结构", () => {
		expect(resolveSchema()).toEqual(SCHEMA_PRESET_CN);
		expect(resolveSchema(null)).toEqual(SCHEMA_PRESET_CN);
		expect(resolveSchema({})).toEqual(SCHEMA_PRESET_CN);
	});

	it("部分覆盖只改被指定的项，其余保留默认", () => {
		const s = resolveSchema({ inbox: "00-Inbox" });
		expect(s.inbox).toBe("00-Inbox");
		expect(s.insights).toBe(SCHEMA_PRESET_CN.insights);
	});

	it("整套英文预设可完整覆盖", () => {
		expect(resolveSchema(SCHEMA_PRESET_EN)).toEqual(SCHEMA_PRESET_EN);
	});

	it("清洗首尾斜杠与空白，空值回退默认", () => {
		const s = resolveSchema({ inbox: "  /00-Inbox/  ", logs: "   " });
		expect(s.inbox).toBe("00-Inbox");
		expect(s.logs).toBe(SCHEMA_PRESET_CN.logs);
	});

	it("非字符串值回退默认（防脏配置）", () => {
		const s = resolveSchema({ inbox: 42 as unknown as string });
		expect(s.inbox).toBe(SCHEMA_PRESET_CN.inbox);
	});
});

describe("VaultPaths", () => {
	it("按中文默认解析常用路径", () => {
		const p = new VaultPaths(resolveSchema());
		expect(p.dir("insights")).toBe("02-洞察");
		expect(p.readme("inbox")).toBe("00-收件箱/_README.md");
		expect(p.mocDir).toBe("02-洞察/MOC");
		expect(p.personaFile).toBe("灵魂/PERSONA.md");
		expect(p.contextFile).toBe("Identity/CONTEXT.md");
		expect(p.outletFile).toBe("输出/统一出口.md");
	});

	it("换成英文预设后所有派生路径同步改变", () => {
		const p = new VaultPaths(resolveSchema(SCHEMA_PRESET_EN));
		expect(p.readme("inbox")).toBe("00-Inbox/_README.md");
		expect(p.mocDir).toBe("02-Insights/MOC");
		expect(p.outletFile).toBe("Output/统一出口.md");
		expect(p.outputPlatform("抖音")).toBe("Output/抖音");
	});

	it("混合命名（内容英文 + 灵魂中文）正确解析", () => {
		const p = new VaultPaths(resolveSchema({ ...SCHEMA_PRESET_EN, soul: "灵魂" }));
		expect(p.readme("insights")).toBe("02-Insights/_README.md");
		expect(p.personaFile).toBe("灵魂/PERSONA.md");
	});

	it("join 过滤空段，不产生双斜杠", () => {
		const p = new VaultPaths(resolveSchema());
		expect(p.join("system", "", "working-memory")).toBe("System/working-memory");
	});
});

describe("schema 键集合", () => {
	it("MODULE_KEYS 覆盖 schema 全部字段", () => {
		expect([...MODULE_KEYS].sort()).toEqual(
			Object.keys(SCHEMA_PRESET_CN).sort()
		);
	});

	it("CONTENT_KEYS 是 MODULE_KEYS 的子集且为六大内容目录", () => {
		expect(CONTENT_KEYS).toHaveLength(6);
		for (const key of CONTENT_KEYS) expect(MODULE_KEYS).toContain(key);
	});

	it("两套预设的键完全一致（避免漏配）", () => {
		expect(Object.keys(SCHEMA_PRESET_EN).sort()).toEqual(
			Object.keys(SCHEMA_PRESET_CN).sort()
		);
	});
});
