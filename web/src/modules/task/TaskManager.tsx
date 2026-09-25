// ── 任务页：URL 驱动视图（列表/看板）与右栏（日历/依赖图）──
// 工具条与主视图已下钻到 components/（TaskToolbar / TaskPanel），这里只剩路由参数与装配。

import { PageHead } from "@components/ui";
import { enumParam, strParam, useUrlParams } from "@shared/utils";
import TaskPanel from "./components/TaskPanel.tsx";
import { TaskProvider } from "./components/TaskProvider.tsx";
import TaskToolbar from "./components/TaskToolbar.tsx";
import styles from "./TaskManager.module.css";

export default function TaskManager() {
	const params = useUrlParams({
		view: enumParam(["list", "kanban"] as const, "list"),
		right: enumParam(["calendar", "dag"] as const, "calendar"),
		q: strParam(""),
	});

	const viewMode = () => params.get("view");
	const setViewMode = (v: "list" | "kanban") => params.set({ view: v });

	const rightTab = () => params.get("right");
	const setRightTab = (t: "calendar" | "dag") => params.set({ right: t });

	const searchQuery = () => params.get("q");
	const onSearchChange = (q: string) => params.set({ q });

	return (
		<TaskProvider>
			<div class={styles.taskManager}>
				<PageHead title="任务" desc="列表 · 看板 · 日历 · 依赖图" />
				<TaskToolbar
					viewMode={viewMode()}
					onViewChange={setViewMode}
					searchQuery={searchQuery()}
					onSearchChange={onSearchChange}
				/>
				<TaskPanel
					viewMode={viewMode()}
					rightTab={rightTab()}
					onRightTabChange={setRightTab}
				/>
			</div>
		</TaskProvider>
	);
}
