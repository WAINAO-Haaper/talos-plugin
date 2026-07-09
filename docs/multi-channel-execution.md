# 屈原多通道执行链路对齐 Claudian · 技术方案

> 日期：2026-06-28 · 状态：P0–P5 全部落地

> **目标**：常用的 Claudian 有的能力，屈原都要有；屈原独占的能力（语音双向 + 长在超级大脑里的人格），Claudian 没有也不动。
> **一句话架构**：把「引擎」抽象成可替换的多通道，`JarvisEvents` 事件总线不变，`panel.ts` / `voiceio.ts` / 人格注入零改动——这是整个方案的承重墙。

---

## 0. 现状与差异（动手前的地图）

现行屈原（`src/jarvis/`）：

```
panel.ts ──订阅──> JarvisEvents <──发射── engine.ts(JarvisEngine)
   │                                          └─ @anthropic-ai/claude-agent-sdk query() · 本机 CLI · 单会话
   ├─ voiceio.ts(StreamTts/MicStt)  ← 差异化①：语音双向
   └─ settingSources 加载 CLAUDE.md → 灵魂/PERSONA  ← 差异化②：屈原人格
```

| 维度 | Claudian | 屈原现状 | 本方案动作 |
|---|---|---|---|
| 执行通道 | SDK/CLI **+ 直连 API** | 仅 SDK/CLI | **加直连 API 通道**（去 CLI / 解除桌面 only） |
| Provider | 多家 + custom | 仅 Anthropic | **加 OpenAI/Codex GPT 通道** |
| 会话 | 多标签 + resume | 单条常驻 | **加会话 store + 多标签 + resume** |
| 能力面板 | subagent/MCP/slash UI | 靠 settingSources 隐式继承 | **显式透出 + 可配** |
| 输入 | @提及 + 图片 | 纯文字 | **加 @提及 + 图片附件** |
| 思考 | 可视化 | 仅 onThinkingDelta 已接 | **补思考折叠块 UI** |
| 语音 | ❌ 无 | ✅ 流式 TTS+STT | **不动（差异化保留）** |
| 人格 | 干净 Claude | ✅ 屈原 + 全套铁律 | **不动（差异化保留）** |

**承重墙原则**：所有新通道都必须发射现有 `JarvisEvents`（`onTextDelta`/`onToolUse`/`onToolResult`/`onPermissionRequest`/`onResult`…）。只要事件契约不破，`voiceio.ts` 的流式朗读、`panel.ts` 的渲染、人格注入全都白嫖，不用改。

---

## 1. 核心架构：Engine 抽象层

把现有 `JarvisEngine` 提升为接口 `Engine`，三个实现并存，由 `EngineFactory` 按 provider 选择。

```
              ┌─────────────── panel.ts (UI, 语音, 人格前缀) ────────────────┐
              │                    订阅 JarvisEvents                          │
              └───────────────────────────┬─────────────────────────────────┘
                                          │ Engine 接口（start/send/interrupt/setPermissionMode/dispose）
        ┌─────────────────────────────────┼─────────────────────────────────┐
        ▼                                 ▼                                 ▼
 SdkCliEngine                     AnthropicApiEngine                  OpenAiEngine
 (现有, 重构)                      (直连 /v1/messages)                 (Codex/GPT function-calling)
   claude-agent-sdk                  └──────────┬──────────┘
   本机 CLI · 全功能                  共用 AgentLoop + VaultToolHost（自管工具循环 + 权限网关）
```

关键判断：
- **SDK/CLI 通道**最强（自带 subagent/MCP/slash/hooks/CLAUDE.md），但依赖本机 CLI、仅桌面。保留为「桌面满血档」。
- **直连 API 通道**要自己实现 agent loop + 工具执行 + 权限门，这是本方案**工作量大头**。换来：无需装 CLI、可上移动端、可换 Provider。
- **OpenAI/Codex 通道**复用直连通道的 AgentLoop 与 VaultToolHost，只换「模型对话协议」那一层（Anthropic messages ↔ OpenAI function calling 的 schema 转换）。

---

## 2. 模块拆分（新增/改动文件树）

```
src/jarvis/
  engine.ts                 → 改：抽出 JarvisEvents/接口到 engine-types.ts，本类重命名 SdkCliEngine 实现 Engine
  engine-types.ts           ★新：Engine 接口 + JarvisEvents + 事件 DTO（从 engine.ts 抽出，无行为）
  engine-factory.ts         ★新：按 settings.engineProvider 造对应 Engine
  panel.ts                  → 改：顶部加「标签条 + Provider 切换」；输入栏加 @ 与 图片；思考折叠块（语音逻辑不动）
  voiceio.ts                → 不动
  providers/
    registry.ts             ★新：Provider 元数据（id/label/通道/默认模型/鉴权字段）
    anthropic-api-engine.ts ★新：直连 /v1/messages，自管流式 + 工具循环
    openai-engine.ts        ★新：Codex/GPT，Responses 或 Chat Completions function calling
  agent/
    loop.ts                 ★新：与厂商无关的 agent 循环（多轮 + 工具回灌 + 中断 + 权限挂起）
    vault-tools.ts          ★新：工具实现（read/write/edit/glob/grep/bash*）+ 权限网关，直连通道共用
    tool-schema.ts          ★新：工具的 JSON Schema（Anthropic / OpenAI 两套投影）
  session/
    store.ts                ★新：会话+标签 store（持久化到 data.json，resume）
  context/
    mentions.ts             ★新：@提及文件 + 图片附件 → content blocks
settings.ts                 → 改：加 engineProvider / 各 Provider 鉴权 / MCP / subagent 开关字段
view.ts                     → 不动（仍 mount JarvisAgentPanel）
```

`bash*`：仅 SDK/CLI 与桌面直连通道可用（`child_process`）；移动端直连通道自动禁用 bash 工具并在 UI 标注。

---

## 3. 关键骨架代码

> 以下为可直接落地的骨架（接口完整、行为留 TODO）。命名沿用现有 `JarvisEvents` 字段，保证 `panel.ts` 订阅不破。

### 3.1 `engine-types.ts` — 统一契约（从现有 engine.ts 抽出）

```ts
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// —— 事件 DTO 沿用现有 engine.ts 定义，原样搬来：ToolUseEvent / ToolResultEvent /
//    PermissionAsk / ResultEvent / SystemInitEvent / JarvisEvents ——
export type { JarvisEvents, ToolUseEvent, ToolResultEvent, PermissionAsk, ResultEvent, SystemInitEvent } from "./engine";

// 用户一条输入：文字 + 可选图片 + @提及（context/mentions.ts 产出）
export interface UserTurn {
  text: string;
  images?: { mime: string; dataB64: string }[];
  mentions?: { path: string; kind: "file" | "selection" }[];
}

// 所有通道实现同一接口 —— panel.ts 只认这个，不认具体厂商
export interface Engine {
  start(): Promise<void>;
  send(turn: UserTurn): void;          // 旧 send(text) 升级为 UserTurn
  interrupt(): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  getSessionId(): string | null;
  resume?(sessionId: string): Promise<void>; // 直连通道靠 store 回放，SDK 通道走 SDK resume
  dispose(): void;
}
```

### 3.2 `providers/registry.ts` — Provider 注册表

```ts
export type Channel = "sdk-cli" | "anthropic-api" | "openai";

export interface ProviderDef {
  id: string;            // "claude-cli" | "claude-api" | "codex"
  label: string;         // UI 显示
  channel: Channel;
  defaultModel: string;
  models: string[];
  apiKeySetting: keyof import("../../settings").TalosSettings | null; // 直连通道取哪个 key
  baseUrlSetting?: keyof import("../../settings").TalosSettings;      // custom / 自建网关
  supportsBash: boolean; // 移动端 + 无 child_process 时强制 false
}

export const PROVIDERS: ProviderDef[] = [
  { id: "claude-cli", label: "Claude（本机 CLI · 满血）", channel: "sdk-cli",
    defaultModel: "", models: ["", "sonnet", "opus"], apiKeySetting: null, supportsBash: true },
  { id: "claude-api", label: "Claude（直连 API · 免 CLI）", channel: "anthropic-api",
    defaultModel: "claude-sonnet-4-6", models: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
    apiKeySetting: "anthropicApiKey", baseUrlSetting: "anthropicBaseUrl", supportsBash: true },
  { id: "codex", label: "Codex / GPT（直连 OpenAI）", channel: "openai",
    defaultModel: "gpt-5-codex", models: ["gpt-5-codex", "gpt-5", "gpt-4.1"],
    apiKeySetting: "openaiApiKey", baseUrlSetting: "openaiBaseUrl", supportsBash: true },
];

export const providerById = (id: string): ProviderDef =>
  PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
```

> 模型串以实际可用为准，这里是占位；custom/自建网关用 `baseUrlSetting` 指向 OpenAI 兼容端点即可复用 `openai` 通道。

### 3.3 `engine-factory.ts` — 通道工厂

```ts
import { App } from "obsidian";
import type { Engine, JarvisEvents } from "./engine-types";
import type { TalosSettings } from "../settings";
import { providerById } from "./providers/registry";
import { SdkCliEngine } from "./engine";               // 现有类，改名实现 Engine
import { AnthropicApiEngine } from "./providers/anthropic-api-engine";
import { OpenAiEngine } from "./providers/openai-engine";

export function createEngine(app: App, settings: TalosSettings, ev: JarvisEvents): Engine {
  const p = providerById(settings.engineProvider);
  switch (p.channel) {
    case "sdk-cli":       return new SdkCliEngine(app, settings, ev);
    case "anthropic-api": return new AnthropicApiEngine(app, settings, ev, p);
    case "openai":        return new OpenAiEngine(app, settings, ev, p);
  }
}
```

### 3.4 `agent/vault-tools.ts` — 共享工具层 + 权限网关

直连通道没有 SDK 帮忙跑工具，这里是核心：把 Read/Write/Edit/Glob/Grep/Bash 实现成对 vault 的操作，每次执行前过权限网关（复用现有 `onPermissionRequest` 卡片）。

```ts
import { App, FileSystemAdapter, TFile } from "obsidian";
import type { JarvisEvents } from "../engine-types";

export interface ToolCall { id: string; name: string; input: Record<string, unknown>; }
export interface ToolOutcome { content: string; isError: boolean; }

export class VaultToolHost {
  constructor(
    private app: App,
    private ev: JarvisEvents,
    private opts: { permissionMode: () => string; supportsBash: boolean }
  ) {}

  // agent loop 调它执行一次工具：先权限门 → 再落地 → 回 ToolOutcome
  async run(call: ToolCall): Promise<ToolOutcome> {
    const gate = await this.gate(call);
    if (gate.behavior === "deny") return { content: gate.message ?? "已拒绝", isError: true };
    try {
      switch (call.name) {
        case "Read":  return await this.read(call.input);
        case "Write": return await this.write(call.input);
        case "Edit":  return await this.edit(call.input);
        case "Glob":  return await this.glob(call.input);
        case "Grep":  return await this.grep(call.input);
        case "Bash":  return this.opts.supportsBash ? await this.bash(call.input)
                                                     : { content: "此端不支持 Bash", isError: true };
        default:      return { content: `未知工具 ${call.name}`, isError: true };
      }
    } catch (e) {
      return { content: e instanceof Error ? e.message : String(e), isError: true };
    }
  }

  // 权限网关：default 模式弹卡片（复用现有审批 UI）；acceptEdits/plan/bypass 按规则放行
  private async gate(call: ToolCall) {
    const mode = this.opts.permissionMode();
    const isWrite = ["Write", "Edit", "Bash"].includes(call.name);
    if (mode === "bypassPermissions") return { behavior: "allow" as const };
    if (mode === "plan" && isWrite) return { behavior: "deny" as const, message: "计划模式只读" };
    if (mode === "acceptEdits" && call.name !== "Bash") return { behavior: "allow" as const };
    if (!this.ev.onPermissionRequest) return { behavior: "allow" as const };
    const res = await this.ev.onPermissionRequest({
      toolUseID: call.id, toolName: call.name, input: call.input,
    });
    return res.behavior === "allow"
      ? { behavior: "allow" as const }
      : { behavior: "deny" as const, message: (res as { message?: string }).message };
  }

  private base(): string {
    const a = this.app.vault.adapter;
    if (!(a instanceof FileSystemAdapter)) throw new Error("仅桌面端可用文件系统工具");
    return a.getBasePath();
  }

  private async read(i: Record<string, unknown>): Promise<ToolOutcome> {
    const f = this.app.vault.getAbstractFileByPath(String(i.file_path));
    if (!(f instanceof TFile)) return { content: "文件不存在", isError: true };
    return { content: await this.app.vault.read(f), isError: false };
  }
  private async write(i: Record<string, unknown>): Promise<ToolOutcome> { /* TODO vault.create/modify */ return { content: "ok", isError: false }; }
  private async edit(i: Record<string, unknown>): Promise<ToolOutcome>  { /* TODO 读→字符串替换→写 */ return { content: "ok", isError: false }; }
  private async glob(i: Record<string, unknown>): Promise<ToolOutcome>  { /* TODO 用 vault.getFiles() 过滤 */ return { content: "", isError: false }; }
  private async grep(i: Record<string, unknown>): Promise<ToolOutcome>  { /* TODO 遍历读文件正则匹配 */ return { content: "", isError: false }; }
  private async bash(i: Record<string, unknown>): Promise<ToolOutcome>  { /* TODO child_process.spawn，cwd=base() */ return { content: "", isError: false }; }
}
```

### 3.5 `agent/loop.ts` — 厂商无关的 agent 循环

```ts
import type { JarvisEvents, UserTurn } from "../engine-types";
import { VaultToolHost, ToolCall } from "./vault-tools";

// 适配器：把不同厂商的「一次模型请求-流式响应」抽象成统一回调。
// AnthropicApiEngine / OpenAiEngine 各自实现 ModelClient，loop 不关心协议差异。
export interface ModelClient {
  // 发一轮（带历史 + 工具结果），流式回吐：文本增量 / 思考增量 / 工具调用 / 结束
  stream(handlers: {
    onTextDelta: (t: string) => void;
    onThinkingDelta: (t: string) => void;
    onToolCall: (c: ToolCall) => void;
    onDone: (stopReason: "end" | "tool_use") => void;
    onError: (e: Error) => void;
  }): Promise<void>;
  pushUser(turn: UserTurn): void;
  pushToolResults(results: { id: string; content: string; isError: boolean }[]): void;
  abort(): void;
}

export class AgentLoop {
  private aborted = false;
  constructor(private model: ModelClient, private tools: VaultToolHost, private ev: JarvisEvents) {}

  async turn(turn: UserTurn): Promise<void> {
    this.model.pushUser(turn);
    this.ev.onBusyChange?.(true);
    await this.runUntilSettled();
    this.ev.onBusyChange?.(false);
  }

  // 多轮工具循环：模型要工具 → 跑工具 → 结果回灌 → 再请求，直到模型给出最终文本
  private async runUntilSettled(): Promise<void> {
    const pending: ToolCall[] = [];
    await new Promise<void>((resolve) => {
      void this.model.stream({
        onTextDelta: (t) => this.ev.onTextDelta?.(t),
        onThinkingDelta: (t) => this.ev.onThinkingDelta?.(t),
        onToolCall: (c) => { this.ev.onToolUse?.(c); pending.push(c); },
        onError: (e) => { this.ev.onError?.(e); resolve(); },
        onDone: async (reason) => {
          if (reason === "tool_use" && pending.length && !this.aborted) {
            const results = [];
            for (const c of pending.splice(0)) {
              const out = await this.tools.run(c);              // ← 过权限门 + 落地
              this.ev.onToolResult?.({ id: c.id, content: out.content, isError: out.isError });
              results.push({ id: c.id, content: out.content, isError: out.isError });
            }
            this.model.pushToolResults(results);
            await this.runUntilSettled();                       // 递归下一轮
            resolve();
          } else {
            this.ev.onResult?.({ isError: false, result: "", costUsd: 0, durationMs: 0, numTurns: 1 });
            resolve();
          }
        },
      });
    });
  }

  abort(): void { this.aborted = true; this.model.abort(); }
}
```

### 3.6 `providers/anthropic-api-engine.ts` — 直连 /v1/messages

```ts
import { App, requestUrl } from "obsidian";
import type { Engine, JarvisEvents, UserTurn } from "../engine-types";
import type { TalosSettings } from "../../settings";
import type { ProviderDef } from "./registry";
import { AgentLoop, ModelClient } from "../agent/loop";
import { VaultToolHost } from "../agent/vault-tools";
import { ANTHROPIC_TOOLS } from "../agent/tool-schema";

export class AnthropicApiEngine implements Engine {
  private loop: AgentLoop | null = null;
  private sessionId: string | null = null;
  constructor(private app: App, private s: TalosSettings, private ev: JarvisEvents, private p: ProviderDef) {}

  async start(): Promise<void> {
    const client = new AnthropicModelClient(this.s, this.p);   // 实现 ModelClient
    const tools = new VaultToolHost(this.app, this.ev, {
      permissionMode: () => this.s.jarvisPermissionMode,
      supportsBash: this.p.supportsBash && hasChildProcess(),
    });
    this.loop = new AgentLoop(client, tools, this.ev);
    this.sessionId = `api-${Date.now()}`;
    this.ev.onSystemInit?.({ sessionId: this.sessionId, model: modelOf(this.s, this.p),
      tools: ANTHROPIC_TOOLS.map((t) => t.name), cwd: "", permissionMode: this.s.jarvisPermissionMode });
  }

  send(turn: UserTurn): void { void this.ensure().then((l) => l.turn(withPersona(turn, this.s))); }
  async interrupt(): Promise<void> { this.loop?.abort(); }
  async setPermissionMode(): Promise<void> { /* 读 settings 即可，无状态切换 */ }
  getSessionId(): string | null { return this.sessionId; }
  dispose(): void { this.loop?.abort(); this.loop = null; }
  private async ensure(): Promise<AgentLoop> { if (!this.loop) await this.start(); return this.loop!; }
}

// —— ModelClient：调 /v1/messages（stream=true, tools=ANTHROPIC_TOOLS），
//    把 SSE 的 content_block_delta(text/thinking) / tool_use / message_stop 映射到 loop 回调。
//    历史消息 + tool_result 自己维护数组（这就是 resume 的回放基础）。
class AnthropicModelClient implements ModelClient {
  /* TODO: requestUrl POST api.anthropic.com/v1/messages, headers x-api-key + anthropic-version;
     维护 messages[]；stream 解析 SSE；pushUser/pushToolResults 往 messages[] 追加 */
}
```

### 3.7 `providers/openai-engine.ts` — Codex / GPT

与 Anthropic 直连通道**同构**，只换 `ModelClient`：用 OpenAI Responses（或 Chat Completions）的 function calling，把工具 schema 投影成 OpenAI 格式，把 `tool_calls` 流映射到同一套 loop 回调。`Engine` 外壳几乎复制 `AnthropicApiEngine`。

```ts
// openai-engine.ts 主体 = AnthropicApiEngine 换 client；只贴差异点：
class OpenAiModelClient implements ModelClient {
  /* TODO:
     - POST {baseUrl}/v1/responses  (Authorization: Bearer openaiApiKey)
     - tools = OPENAI_TOOLS（tool-schema.ts 的 OpenAI 投影：{type:"function", function:{name,parameters}}）
     - 流式：解析 response.output_text.delta → onTextDelta；
              function_call 项 → onToolCall；completed → onDone
     - reasoning 模型的 thinking 摘要 → onThinkingDelta（有则接，无则忽略）
     - 历史：维护 input[] / previous_response_id 做多轮 */
}
```

> 这样「接入 Codex/GPT」= 写一个 `OpenAiModelClient`，agent loop、工具执行、权限门、语音、人格全复用。custom/自建 OpenAI 兼容网关同理，改 `baseUrl` 即可。

### 3.8 `agent/tool-schema.ts` — 一套工具，两套投影

```ts
export const TOOLS = [
  { name: "Read",  desc: "读取库内文件", params: { file_path: "string" } },
  { name: "Write", desc: "写入/创建文件", params: { file_path: "string", content: "string" } },
  { name: "Edit",  desc: "字符串替换编辑", params: { file_path: "string", old_string: "string", new_string: "string" } },
  { name: "Glob",  desc: "按通配找文件", params: { pattern: "string" } },
  { name: "Grep",  desc: "全库正则搜索", params: { pattern: "string", glob: "string?" } },
  { name: "Bash",  desc: "跑 shell（桌面端）", params: { command: "string" } },
];
// → ANTHROPIC_TOOLS: {name, description, input_schema:{type:object, properties...}}
// → OPENAI_TOOLS:    {type:"function", function:{name, description, parameters:{...}}}
export const ANTHROPIC_TOOLS = TOOLS.map(/* TODO 投影 */);
export const OPENAI_TOOLS    = TOOLS.map(/* TODO 投影 */);
```

### 3.9 `session/store.ts` — 会话 + 多标签 + resume

```ts
export interface ConversationMeta { id: string; title: string; provider: string; sessionId: string | null; updatedAt: number; }
export interface Conversation extends ConversationMeta {
  history: unknown[];   // 直连通道：原始 messages[]（回放即 resume）；SDK 通道：仅存 sessionId 走 SDK resume
}

export class SessionStore {
  private convs: Map<string, Conversation> = new Map();
  private activeId: string | null = null;
  constructor(private save: (data: ConversationMeta[]) => Promise<void>) {}

  list(): ConversationMeta[] { return [...this.convs.values()].sort((a, b) => b.updatedAt - a.updatedAt); }
  open(id: string): Conversation | null { this.activeId = id; return this.convs.get(id) ?? null; }
  create(provider: string): Conversation { /* TODO new id, push, setActive */ return null as never; }
  appendHistory(id: string, items: unknown[]): void { /* TODO + 持久化 meta 到 data.json */ }
  // resume：直连 → 把 history 灌回 ModelClient.messages[]；SDK → query(... { resume: sessionId })
}
```

> 持久化只存 `ConversationMeta`（轻），完整 `history` 可选落库或仅 session 内存——避免 data.json 膨胀。多标签条 = `list()` 渲染 + `open()` 切换 + `create()` 新开，对应 Claudian 的 `tabManager`。

### 3.10 `context/mentions.ts` — @提及 + 图片 → content blocks

```ts
import { App, TFile } from "obsidian";
import type { UserTurn } from "../engine-types";

export class MentionPicker {
  constructor(private app: App) {}
  // 输入框打 @ → 弹文件模糊搜索（用 app.metadataCache / vault.getFiles），选中插入 [[path]] 占位
  suggest(query: string): TFile[] { return this.app.vault.getMarkdownFiles()
    .filter((f) => f.path.toLowerCase().includes(query.toLowerCase())).slice(0, 20); }

  // 提交时：把 @提及文件读成文本块拼进 prompt；图片转 base64 作 image block
  async build(text: string, mentionPaths: string[], imageFiles: File[]): Promise<UserTurn> {
    const mentions = mentionPaths.map((p) => ({ path: p, kind: "file" as const }));
    const images = await Promise.all(imageFiles.map(async (f) => ({
      mime: f.type, dataB64: await fileToB64(f),
    })));
    return { text, images, mentions };
  }
}
```

### 3.11 `settings.ts` 扩展字段

```ts
// 追加到 TalosSettings：
engineProvider: string;     // "claude-cli" | "claude-api" | "codex"，默认 "claude-cli"
anthropicApiKey: string;    // 直连 Claude
anthropicBaseUrl: string;   // 留空用官方
openaiApiKey: string;       // Codex/GPT
openaiBaseUrl: string;      // 留空用官方；custom 网关填这里
mcpServersJson: string;     // 直连通道的 MCP 配置（JSON），SDK 通道仍走 .mcp.json
enabledSubagents: string;   // 透出/限定的子智能体名单（逗号分隔，空=全部继承）
```

设置页加一个「执行通道」下拉（`PROVIDERS` 渲染）+ 对应 Provider 的 key/baseUrl 输入；现有屈原/TTS/STT 区块全部保留不动。

### 3.12 `panel.ts` 改动点（语音/人格不动）

只加三处，全部挂在现有事件流之上：
1. **顶部标签条**：`SessionStore.list()` 渲染标签 + 「＋新会话」；切换调 `engine.resume(sessionId)` 或重建 Engine。
2. **Provider 切换**：状态条旁加下拉，改 `settings.engineProvider` → `dispose()` 旧 Engine → `createEngine()` 新的（事件回调不变）。
3. **输入栏**：`@` 触发 `MentionPicker.suggest`；粘贴/拖拽图片入 `imageFiles`；`submit()` 改走 `MentionPicker.build()` 产出 `UserTurn`。
4. **思考折叠块**：`onThinkingDelta` 已接，补一个可折叠 `<details>` 容器渲染（现在是裸增量）。

`ensureVoice()` / `tts.feed()` / 人格前缀 `withPersona()` 全不动——新通道一样发 `onTextDelta`，语音照样流式朗读。

---

## 4. SDK ↔ 直连 API 字段映射（实现对照表）

| 概念 | SDK/CLI（现有） | 直连 Anthropic | 直连 OpenAI/Codex |
|---|---|---|---|
| 发起 | `query({prompt,options})` | POST `/v1/messages` `stream:true` | POST `/v1/responses` |
| 文本增量 | `stream_event.content_block_delta.text_delta` | SSE `content_block_delta` | `response.output_text.delta` |
| 思考增量 | `thinking_delta` | `content_block_delta`(thinking) | reasoning summary delta |
| 工具调用 | `assistant.tool_use` block | `content_block`(tool_use) | `function_call` 项 |
| 工具结果回灌 | 自动（SDK 跑工具） | 自己 append `tool_result` user msg | append `function_call_output` |
| 权限 | `canUseTool` 回调 | **自建 VaultToolHost.gate** | 同左 |
| 多轮/resume | `{resume: sessionId}` | 回放本地 `messages[]` | `previous_response_id` |
| 子智能体/MCP/slash | SDK + settingSources 原生 | 需自建（见 §5） | 需自建 |
| CLAUDE.md/人格 | settingSources 自动 | 手动把 CLAUDE.md 读进 system prompt | 同左 |

**诚实提醒**：直连通道要手动把库的 `CLAUDE.md` / `灵魂/PERSONA` 读进 system prompt 才能保住屈原人格——SDK 通道是白送的。`withPersona()` 就干这件事。

---

## 5. 子智能体 / MCP / 斜杠命令的透出

- **SDK/CLI 通道**：本就由 settingSources 继承 `.claude/agents`、`.mcp.json`、`.claude/commands`。本方案只是把它们**读出来在 UI 列出/可点**（能力中心已有读 `.claude/commands+agents` 的逻辑，复用）。
- **直连通道**：SDK 不在场，需轻量自建——
  - 斜杠命令：把 `.claude/commands/*.md` 读成 prompt 模板，`/name` 展开后塞进 `UserTurn.text`（纯前端展开，不依赖 SDK）。
  - 子智能体：把 `.claude/agents/*.md` 当「带专属 system prompt 的子 AgentLoop」跑，结果回灌主循环（进阶，可后置）。
  - MCP：直连通道接 MCP 要自带 MCP client（`@modelcontextprotocol/sdk`），把 MCP tools 注册进 `VaultToolHost`。工作量较大，建议最后做或仅 SDK 通道支持。

---

## 6. 分期落地（按风险/收益排序）

| 阶段 | 内容 | 产出可用能力 | 风险 |
|---|---|---|---|
| **P0** | 抽 `engine-types.ts` + `Engine` 接口 + `engine-factory`，现有类改名 `SdkCliEngine` 实现接口 | 零行为变化，纯重构，解锁后续 | 低（回归测现有屈原） |
| **P1** | `VaultToolHost` + `AgentLoop` + `AnthropicApiEngine` + tool-schema | **直连 Claude，免 CLI、可上移动端** | 中（自建工具循环 + 权限门） |
| **P2** | `OpenAiModelClient` + Provider 下拉 + 设置 | **Codex/GPT 接入、可切 Provider** | 低（复用 P1 骨架） |
| **P3** | `SessionStore` + 标签条 + resume | **多标签 + 会话恢复** | 中（持久化/回放一致性） |
| **P4** | `MentionPicker` + 图片附件 + 思考折叠块 | **@提及 / 图片 / 思考可视化** | 低 |
| **P5** | 斜杠/子智能体/MCP 透出 | **能力面板对齐** | 中高（MCP client 最重） |

每阶段独立可发布，P0/P1 是地基。建议每阶段起新 context（长任务，见 `loop-safety`）。

---

## 7. 风险与回滚

- **直连通道的工具循环 = 重新造 SDK 的轮子**：Read/Write/Edit/Grep/Glob/Bash + 权限 + 多轮回灌，是工作量大头。回滚：P0 后任何阶段失败，`engineProvider` 切回 `claude-cli` 即恢复现状，互不影响。
- **bash/child_process 在移动端不可用**：`supportsBash:false` 时 UI 灰掉 Bash 工具并提示，模型走纯文件工具。
- **人格漂移**：直连通道若忘了灌 CLAUDE.md/PERSONA，屈原会退化成干净模型。`withPersona()` 必须读库人格层；加一条回归断言「直连通道 system prompt 含 PERSONA 标识」。
- **密钥安全**：API key 存 data.json（明文），与 Claudian 同级别风险；遵循 `安全分级`，设置页标注「key 明文存本地」。
- **包体**：直连通道不引 SDK 客户端可更小；OpenAI/MCP client 会增重，按需动态 import。

---

## 8. 差异化保留验证清单（每阶段回验）

- [ ] 切到任意通道，流式朗读仍工作（`onTextDelta → tts.feed`）。
- [ ] 切到任意通道，麦克风 STT 仍工作（与 Engine 解耦）。
- [ ] 直连通道 system prompt 含库 `灵魂/PERSONA` 人格标识（屈原不漂移）。
- [ ] 权限审批卡片在三通道行为一致（拒绝即不落地）。
- [ ] `panel.ts` 未因换通道改动语音/人格相关代码。

> 守住这五条 = 差异化没丢、Claudian 能力对齐。屈原始终是「会说话的、长在超级大脑里的那个它」，只是脚下多了几条腿。
