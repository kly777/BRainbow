// ── /task 的视图模型：URL 状态、范围/排序、录入与标签搜索 ──
//
// 页面只消费这个 hook，不再自己拼 useTasks/useUrlParams/useTaskCalendar。

import { notifySuccess } from "@shared/errors";
import { enumParam, strParam, useUrlParams } from "@shared/utils";
import { useNavigate } from "@solidjs/router";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { TagOption } from "@components/ui/molecules/TagInput.tsx";
import { useTasks } from "../data/TaskProvider.tsx";
import { taskRepository } from "../data/taskRepository.ts";
import { useTaskCalendar } from "../hooks/useTaskCalendar.ts";
import { EMPTY_FILTER, isFilterEmpty } from "../model/task-filter.ts";
import { captureToCreateRequest } from "../model/task-payload.ts";
import {
	TASK_SCOPES,
	countScopes,
	scopeTasks,
	type TaskScope,
} from "../model/task-scope.ts";
import { fillPath, PATHS } from "@config/paths";

export type TaskView = "stream" | "board" | "graph";

export function useTaskWorkspaceView() {
	const params = useUrlParams({
		scope: enumParam(
			["all", "today", "upcoming", "overdue", "completed"] as const,
			"all",
		),
		view: enumParam(["stream", "board", "graph"] as const, "stream"),
		q: strParam(""),
	});
	const navigate = useNavigate();
	const {
		tasks,
		loading,
		add,
		updateStatus,
		removeTask,
		filter,
		setFilter,
		sort,
		setSort,
		setQuery,
	} = useTasks();
	const [filterOpen, setFilterOpen] = createSignal(false);
	const calendar = useTaskCalendar();

	const scope = () => params.get("scope");
	const view = () => params.get("view");
	const searchQuery = () => params.get("q");

	let appliedQuery = "";
	createEffect(() => {
		const query = searchQuery();
		if (query === appliedQuery) return;
		appliedQuery = query;
		setQuery(query);
	});

	const counts = createMemo(() => countScopes(tasks()));
	const scoped = createMemo(() => scopeTasks(tasks(), scope()));

	const chooseScope = (next: TaskScope) => {
		params.set({ scope: next, view: "stream" });
	};

	const chooseView = (next: TaskView) => {
		params.set({ view: next });
	};

	const setSearch = (query: string) => params.set({ q: query });

	const openTask = (taskId: number) =>
		navigate(fillPath(PATHS.taskDetail, taskId));

	const submit = async (
		payload: Parameters<typeof captureToCreateRequest>[0],
	) => {
		const created = await add(captureToCreateRequest(payload));
		if (!created) return false;
		notifySuccess("已创建", created.title);
		return true;
	};

	let tagSearchTimer: ReturnType<typeof setTimeout> | undefined;
	const searchTags = (query: string): Promise<TagOption[]> =>
		new Promise((resolve) => {
			clearTimeout(tagSearchTimer);
			tagSearchTimer = setTimeout(async () => {
				try {
					resolve(await taskRepository.tags(query));
				} catch {
					resolve([]);
				}
			}, 200);
		});

	const pageTitle = () => {
		if (view() === "board") return "看板";
		if (view() === "graph") return "依赖关系";
		return "任务";
	};

	return {
		tasks,
		loading,
		updateStatus,
		removeTask,
		filter,
		setFilter,
		sort,
		setSort,
		scope,
		view,
		searchQuery,
		filterOpen,
		setFilterOpen,
		counts,
		scoped,
		chooseScope,
		chooseView,
		setSearch,
		openTask,
		submit,
		searchTags,
		pageTitle,
		calendar,
		hasFilter: () => !isFilterEmpty(filter()),
		scopes: TASK_SCOPES,
		emptyFilter: EMPTY_FILTER,
	};
}
