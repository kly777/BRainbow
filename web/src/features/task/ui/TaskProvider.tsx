import {
	createContext,
	createSignal,
	type JSX,
	onMount,
	useContext,
} from "solid-js";
import { getErrorMessage } from "../../../apis/types/index.ts";
import { notifyError } from "../../../lib/notify.ts";
import { showConfirm, tryOrNotify } from "../../../lib/safe-action.ts";
import {
	createTaskE as apiCreateTask,
	deleteTaskE as apiDeleteTask,
	updateTaskE as apiUpdateTask,
	getTaskStatsE,
	getTasksE,
	searchTasksE,
} from "../api.ts";
import type { CreateTaskRequest, Task } from "../types.ts";
import {
	fetchTasksByFilter,
	makeTemp,
	STATUS_API,
} from "./task-provider-utils.ts";

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
		try {
			const r = await getTasksE();
			setTasks([...r.items]);
		} catch (e) {
			console.error("加载任务失败:", getErrorMessage(e));
		} finally {
			setLoading(false);
		}
	};

	const reloadStats = async () => {
		try {
			setStats(await getTaskStatsE());
		} catch (e) {
			console.error("获取统计失败:", getErrorMessage(e));
		}
	};

	onMount(() => {
		reload();
		reloadStats();
	});

	const add = async (req: CreateTaskRequest): Promise<Task | null> => {
		const temp = makeTemp(req);
		setTasks((p) => [temp, ...p]);
		try {
			const real = await apiCreateTask(req);
			setTasks((p) => p.map((t) => (t.id === temp.id ? real : t)));
			return real;
		} catch (e) {
			notifyError("创建任务失败", e);
			setTasks((p) => p.filter((t) => t.id !== temp.id));
			return null;
		}
	};

	const updateStatus = async (id: number, newStatus: string) => {
		const prev = tasks();
		const idx = prev.findIndex((t) => t.id === id);
		if (idx === -1) return;
		const orig = prev[idx];
		setTasks(prev.map((t, i) => (i === idx ? { ...t, status: newStatus } : t)));

		try {
			const apiFn = STATUS_API[newStatus];
			if (!apiFn) throw new Error(`未知状态: ${newStatus}`);
			const updated = await apiFn(id);
			setTasks((c) => c.map((t) => (t.id === id ? updated : t)));
			await reloadStats();
		} catch (e) {
			notifyError("更新状态失败", e);
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
		setTasks(prev.map((t, i) => (i === idx ? { ...t, ...updates } : t)));
		try {
			const updated = await apiUpdateTask(id, updates);
			setTasks((c) => c.map((t) => (t.id === id ? updated : t)));
			await reloadStats();
		} catch (e) {
			notifyError("更新任务失败", e);
			setTasks((c) => c.map((t) => (t.id === id ? orig : t)));
		}
	};

	const addSubTask = async (parentId: number, title: string) => {
		try {
			const real = await apiCreateTask({ title, parent_task_id: parentId });
			setTasks((p) => [...p, real]);
		} catch (e) {
			notifyError("创建子任务失败", e);
		}
	};

	const filterByStatus = async (status: string) => {
		try {
			const r = await fetchTasksByFilter(status);
			setTasks([...r.items]);
		} catch (e) {
			console.error("筛选失败:", getErrorMessage(e));
		}
	};

	const handleSearch = async (query: string) => {
		if (!query) {
			await reload();
			return;
		}
		setLoading(true);
		try {
			const r = await searchTasksE(query);
			setTasks([...r.items]);
		} catch (e) {
			console.error("搜索失败:", getErrorMessage(e));
		} finally {
			setLoading(false);
		}
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
