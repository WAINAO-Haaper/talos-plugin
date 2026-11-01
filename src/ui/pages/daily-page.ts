// 旧的执行节奏页面转到今日页面，保留任务与焦点入口。
import type { Collected } from "../talos-view-model";
import type { TalosView } from "../../view";
import { renderTodayPage } from "./today-page";

export function renderDailyPage(view: TalosView, page: HTMLElement, d: Collected): void {
	renderTodayPage(view, page, d);
}
