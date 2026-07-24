import type { JarvisEvents, UserTurn, UsageInfo } from "../engine-types";
import type {
	ToolCall,
	ToolOutcome,
	ToolResult,
} from "./vault-tools";

// ============================================================
// AgentLoop · 与厂商无关的 agent 多轮循环
//   模型一次响应 → 若要工具：跑工具(过权限门) → 结果回灌 → 再请求，
//   直到模型给出最终文本。文本/思考增量原样转成 JarvisEvents，
//   语音(voiceio)与渲染(panel)照常订阅，不知道底层是哪家模型。
// ============================================================

export interface StreamHandlers {
	onTextDelta: (t: string) => void;
	onThinkingDelta: (t: string) => void;
	onToolCall: (c: ToolCall) => void;
	onUsage: (u: UsageInfo) => void;
	onDone: (stop: "end" | "tool_use") => void;
	onError: (e: Error) => void;
}

// 不同厂商各实现 ModelClient：把「一次模型请求-流式响应」抽象成统一回调。
export interface ModelClient {
	pushUser(turn: UserTurn): void;
	pushToolResults(results: ToolResult[]): void;
	stream(h: StreamHandlers): Promise<void>;
	abort(): void;
}

export interface AgentToolRunner {
	run(call: ToolCall): Promise<ToolOutcome>;
}

const MAX_STEPS = 50; // 单轮工具循环上限，防失控（呼应 loop-safety）

export class AgentLoop {
	private aborted = false;

	constructor(private model: ModelClient, private tools: AgentToolRunner, private ev: JarvisEvents) {}

	async turn(turn: UserTurn): Promise<void> {
		this.aborted = false;
		this.model.pushUser(turn);
		this.ev.onBusyChange?.(true);
		let steps = 0;
		try {
			while (steps++ < MAX_STEPS && !this.aborted) {
				const { stop, calls } = await this.once();
				if (stop === "tool_use" && calls.length) {
					// 中断或已达步数上限：不执行工具，但必须回灌错误结果——
					// 否则 assistant 消息里的 tool_use 没有对应 tool_result，
					// 会话被毒化，下一轮请求直接 400。
					if (this.aborted || steps >= MAX_STEPS) {
						this.model.pushToolResults(
							calls.map((c) => ({
								id: c.id,
								content: this.aborted
									? "已被用户中断，工具未执行"
									: `已达单轮工具循环上限（${MAX_STEPS}），工具未执行`,
								isError: true,
							}))
						);
						if (!this.aborted) {
							this.ev.onError?.(new Error(`已达单轮工具循环上限（${MAX_STEPS}），本轮提前收尾`));
						}
						break;
					}
					const results: ToolResult[] = [];
					for (const c of calls) {
						this.ev.onToolUse?.(c);
						const out = await this.tools.run(c);
						this.ev.onToolResult?.({ id: c.id, content: out.content, isError: out.isError });
						results.push({ id: c.id, content: out.content, isError: out.isError });
					}
					this.model.pushToolResults(results);
					continue; // 回灌后再问一轮
				}
				break; // 终态文本，收尾
			}
			this.ev.onResult?.({ isError: false, result: "", costUsd: 0, durationMs: 0, numTurns: steps });
		} catch (e) {
			this.ev.onError?.(e instanceof Error ? e : new Error(String(e)));
		} finally {
			this.ev.onBusyChange?.(false);
		}
	}

	// 跑一次模型请求，收集本轮 tool 调用，resolve 出停止原因
	private once(): Promise<{ stop: "end" | "tool_use"; calls: ToolCall[] }> {
		return new Promise((resolve, reject) => {
			const calls: ToolCall[] = [];
			void this.model.stream({
				onTextDelta: (t) => this.ev.onTextDelta?.(t),
				onThinkingDelta: (t) => this.ev.onThinkingDelta?.(t),
				onToolCall: (c) => calls.push(c),
				onUsage: (u) => this.ev.onUsage?.(u),
				onError: (e) => reject(e),
				onDone: (stop) => resolve({ stop, calls }),
			});
		});
	}

	abort(): void {
		this.aborted = true;
		this.model.abort();
	}
}
