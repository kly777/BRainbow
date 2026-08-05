import {
	createContext,
	createSignal,
	type JSX,
	onMount,
	useContext,
} from "solid-js";
import { tryAsync } from "@lib/result.ts";
import { notifyError } from "@lib/notify.ts";
import { showConfirm, tryOrNotify } from "@lib/safe-action.ts";
import {
	createTaskE as apiCreateTask,
	deleteTaskE as apiDeleteTask,
	updateTaskE as apiUpdateTask,
	getTaskStatsE,
	getTasksE,
	searchTasksE,
} from "@features/task/api.ts";
import type { CreateTaskRequest, Task } from "@features/task/types.ts";
import {
	fetchTasksByFilter,
	makeTemp,
	STATUS_API,
} from "@features/task/ui/task-provider-utils.ts";

interface Stats {
	backlog: number;
	active: number;
	completed: number;
	archived: number;
}

interface TaskCtxValue {
	tasks: () => Task[];
	loading: () => boolean;
	stats: () => Stats;
	add(req: CreateTaskRequest): Promise<Task | null>;
	reload(): Promise<void>;
	reloadStats(): Promise<void>;
	updateStatus(id: number, status: string): Promise<void>;
	removeTask(id: number): Promise<void>;
	updateTaskE(id: number, updates: Partial<Task>): Promise<void>;
	addSubTask(parentId: number, title: string): Promise<void>;
	filterByStatus(status: string): Promise<void>;
	search(query: string): Promise<void>;
}

const TaskCtx = createContext<TaskCtxValue>();

export function TaskProvider(props: { children: JSX.Element }) {
	const [tasks, setTasks] = createSignal<Task[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [stats, setStats] = createSignal<Stats>({
		backlog: 0,
		active: 0,
		completed: 0,
		archived: 0,
	});

	const reload = async () => {
		setLoading(true);
		const result = await tryAsync(() => getTasksE());
		if (result.ok) {
			setTasks([...result.value.items]);
		} else {
			notifyError("加载任务失败", result.error);
		}
		setLoading(false);
	};

	const reloadStats = async () => {
		const result = await tryAsync(() => getTaskStatsE());
		if (result.ok) {
			setStats(result.value);
		} else {
			notifyError("获取统计失败", result.error);
		}
	};

	onMount(() => {
		reload();
		reloadStats();
	});

	const add = async (req: CreateTaskRequest): Promise<Task | null> => {
		const temp = makeTemp(req);
		setTasks((p) => [temp, ...p]);

		const result = await tryAsync(() => apiCreateTask(req));
		if (result.ok) {
			setTasks((p) => p.map((t) => (t.id === temp.id ? result.value : t)));
			return result.value;
		}
		// 失败：回滚乐观更新
		setTasks((p) => p.filter((t) => t.id !== temp.id));
		return null;
	};

	const updateStatus = async (id: number, newStatus: string) => {
		const prev = tasks();
		const idx = prev.findIndex((t) => t.id === id);
		if (idx === -1) return;
		const orig = prev[idx];

		// 乐观更新
		setTasks(prev.map((t, i) => (i === idx ? { ...t, status: newStatus } : t)));

		const apiFn = STATUS_API[newStatus];
		if (!apiFn) {
			// 非法状态：回滚
			setTasks((c) =>
				c.map((t) => (t.id === id ? { ...t, status: orig.status } : t)),
			);
			return;
		}

		const result = await tryAsync(() => apiFn(id));
		if (result.ok) {
			setTasks((c) => c.map((t) => (t.id === id ? result.value : t)));
			await reloadStats();
		} else {
			// 失败：回滚
			setTasks((c) =>
				c.map((t) => (t.id === id ? { ...t, status: orig.status } : t)),
			);
		}
	};

	const removeTask = async (id: number) => {
		const confirmed = await showConfirm({
			title: "删除任务",
			message: "确定要删除这个任务吗？子任务也会被一并删除。",
			variant: "danger",
		});
		if (!confirmed) return;
		const prev = tasks();
		setTasks(prev.filter((t) => t.id !== id));
		const ok = await tryOrNotify(() => apiDeleteTask(id), "删除任务");
		if (!ok) await reload();
	};

	const updateTaskE = async (id: number, updates: Partial<Task>) => {
		const prev = tasks();
		const idx = prev.findIndex((t) => t.id === id);
		if (idx === -1) return;
		const orig = prev[idx];

		// 乐观更新
		setTasks(prev.map((t, i) => (i === idx ? { ...t, ...updates } : t)));

		const result = await tryAsync(() => apiUpdateTask(id, updates));
		if (result.ok) {
			setTasks((c) => c.map((t) => (t.id === id ? result.value : t)));
			await reloadStats();
		} else {
			// 失败：回滚
			setTasks((c) => c.map((t) => (t.id === id ? orig : t)));
		}
	};

	const addSubTask = async (parentId: number, title: string) => {
		const result = await tryAsync(() =>
			apiCreateTask({ title, parent_task_id: parentId }),
		);
		if (result.ok) {
			setTasks((p) => [...p, result.value]);
		}
	};

	const filterByStatus = async (status: string) => {
		const result = await tryAsync(() => fetchTasksByFilter(status));
		if (result.ok) {
			setTasks([...result.value.items]);
		} else {
			notifyError("筛选任务失败", result.error);
		}
	};

	const handleSearch = async (query: string) => {
		if (!query) {
			await reload();
			return;
		}
		setLoading(true);
		const result = await tryAsync(() => searchTasksE(query));
		if (result.ok) {
			setTasks([...result.value.items]);
		} else {
			notifyError("搜索任务失败", result.error);
		}
		setLoading(false);
	};

	const ctx: TaskCtxValue = {
		tasks,
		loading,
		stats,
		add,
		reload,
		reloadStats,
		updateStatus,
		removeTask,
		updateTaskE,
		addSubTask,
		filterByStatus,
		search: handleSearch,
	};

	return <TaskCtx.Provider value={ctx}>{props.children}</TaskCtx.Provider>;
}

export function useTasks() {
	const ctx = useContext(TaskCtx);
	if (!ctx) {
		console.error("useTasks: 组件未包裹在 TaskProvider 内");
		const empty: Task[] = [];
		const zero = { backlog: 0, active: 0, completed: 0, archived: 0 };
		return {
			tasks: () => empty,
			loading: () => false,
			stats: () => zero,
			add: async () => null,
			reload: async () => {},
			reloadStats: async () => {},
			updateStatus: async () => {},
			removeTask: async () => {},
			updateTaskE: async () => {},
			addSubTask: async () => {},
			filterByStatus: async () => {},
			search: async () => {},
		};
	}
	return ctx;
}
