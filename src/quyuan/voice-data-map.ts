import { inspectVaultPath } from "../ai/context/secret-policy";
import type { TalosSettings } from "../settings";

// ============================================================
// C-3 语音数据地图：每轮语音回合注入，把口语意图路由到具体仓库路径。
//   只声明读取位置与意图路由，不授予任何写权限——语音硬只读门在
//   voice-driver 的审批回调里前置拦截非读类工具。
// ============================================================

export function buildTalosDataMap(
	settings: TalosSettings,
	configDir?: string
): string {
	const paths = [
		settings.tasksPath,
		settings.talosTasksPath,
		settings.healthLogPath,
		settings.reportsFolder,
		settings.pendingApprovalsPath,
		settings.candidatesPath,
		settings.inboxFolder,
		settings.dailyFolder,
	];
	if (paths.some((path) => inspectVaultPath(path, { configDir }).blocked)) {
		throw new Error("TALOS 数据地图包含永久禁区或不安全路径");
	}
	return `<talos_data_map>
以下是 TALOS 仓库数据的读取位置，回答时用读类工具（read/grep/glob/search）查看后再作答；路径不存在就如实说没读到。
- 今日任务与进度：${settings.tasksPath}；全部任务清单：${settings.talosTasksPath}
- 系统健康与统计：${settings.healthLogPath}；报告目录：${settings.reportsFolder}
- 待审批事项：${settings.pendingApprovalsPath}；偏好候选：${settings.candidatesPath}
- 收件箱速记：${settings.inboxFolder}；每日日记：${settings.dailyFolder}
意图路由：问任务、进度、今天做什么 → 读任务清单；问系统状态、健康分、统计 → 读健康日志和报告目录；问待审批、要我决定的 → 读待审批；问收件箱、速记 → 读收件箱；问日记 → 读每日日记。
</talos_data_map>`;
}
