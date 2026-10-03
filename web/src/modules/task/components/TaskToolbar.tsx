// 任务页工具条：视图切换 + 搜索 + 录入（从 TaskManager.tsx 下钻）
//
// 录入框从"裸 input"换成 CaptureInput（两层结构）：第 1 层仍是单行回车即建，
// 第 2 层由 `[+]` 唤出六个可选控件；`!p1` / `#标签` / `~60m` / `@提及` 的符号
// 与全局浮窗共用同一套解析规则（lib/capture.ts）。

import { FilterGroup, SearchInput, Select } from "@components/ui";
import { notifySuccess } from "@shared/utils";
import { For } from "solid-js";
import type { CreateTaskRequest, TaskSortKey } from "../api.ts";
import { captureToCreateRequest } from "../lib/task-payload.ts";
import styles from "../TaskManager.module.css";
import type { CaptureSubmit } from "./CaptureInput.tsx";
import CaptureInput from "./CaptureInput.tsx";
import { useTasks } from "./TaskProvider.tsx";

export interface TaskToolbarProps {
	viewMode: "list" | "kanban";
	onViewChange: (v: "list" | "kanban") => void;
	searchQuery: string;
	onSearchChange: (q: string) => void;
}

/** 排序下拉的选项：smart 是默认（系统算"先做哪件"），其余是用户可选的显式口径 */
const SORT_OPTIONS: readonly { value: TaskSortKey; label: string }[] = [
	{ value: "smart", label: "智能" },
	{ value: "due", label: "截止时间" },
	{ value: "priority", label: "优先级" },
	{ value: "effort", label: "工时" },
	{ value: "created", label: "创建时间" },
];

export default function TaskToolbar(props: TaskToolbarProps) {
	const { add, search, reload, tasks, sort, setSort } = useTasks();

	const doSearch = (q: string) => {
		if (q) search(q);
		else reload();
		props.onSearchChange(q);
	};

	/** 提交：乐观插入由 provider 负责，这里只负责提一句提示（P2：不弹模态、不跳转） */
	const submit = async (payload: CaptureSubmit) => {
		const req: CreateTaskRequest = captureToCreateRequest(payload);
		const created = await add(req);
		if (created) {
			notifySuccess("已创建", created.title);
		}
	};

	return (
		<div class={styles.toolbar}>
			<FilterGroup
				options={[
					{ value: "list", label: "列表" },
					{ value: "kanban", label: "看板" },
				]}
				selected={props.viewMode}
				onChange={(v) => props.onViewChange(v as "list" | "kanban")}
			/>

			<div class={styles.searchBox}>
				<SearchInput
					value={props.searchQuery}
					onSearch={doSearch}
					placeholder="搜索任务…"
				/>
			</div>

			<Select
				class={styles.sortSelect}
				value={sort()}
				onChange={(e) => setSort(e.currentTarget.value as TaskSortKey)}
				aria-label="排序方式"
				title="排序方式"
			>
				<For each={SORT_OPTIONS}>
					{(option) => <option value={option.value}>{option.label}</option>}
				</For>
			</Select>

			<div class={styles.quickAddBox}>
				{/* 父任务候选给的是当前列表（含层级）：够常用，又不为下拉多打一次请求 */}
				<CaptureInput
					placeholder="+ 快速添加… !p1 #标签 ~60m"
					parentCandidates={tasks()}
					onSubmit={submit}
				/>
			</div>
		</div>
	);
}
