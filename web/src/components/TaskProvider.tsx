import { Effect } from "effect";
import { createContext, createSignal, onMount, type JSX, useContext } from "solid-js";
import {
	activateTask,
	archiveTask,
	completeTask,
	createTask as apiCreateTask,
	deleteTask as apiDeleteTask,
	getActiveTasks,
	getAllTasks,
	getBacklogTasks,
	getCompletedTasks,
	getTaskStats,
	getTasks,
	moveToBacklog,
	searchTasks,
	updateTask as apiUpdateTask,
} from "../apis/taskApi.ts";
import type { CreateTaskRequest, Task } from "../apis/types/index.ts";
import { getErrorMessage } from "../apis/types/index.ts";

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
	updateTask(id: number, updates: Partial<Task>): Promise<void>;
	addSubTask(parentId: number, title: string): Promise<void>;
	filterByStatus(status: string): Promise<void>;
	search(query: string): Promise<void>;
}

const TaskCtx = createContext<TaskCtxValue>();

function makeTemp(req: CreateTaskRequest): Task {
	return {
		id: Date.now(),
		title: req.title,
		description: req.description ?? null,
		parent_task_id: req.parent_task_id ?? null,
		status: "backlog",
		completed_at: null,
		effort_estimate_minutes: req.effort_estimate_minutes ?? null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	};
}

export function TaskProvider(props: { children: JSX.Element }) {
	const [tasks, setTasks] = createSignal<Task[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [stats, setStats] = createSignal<Stats>({ backlog: 0, active: 0, completed: 0, archived: 0 });

	const reload = async () => {
		setLoading(true);
		try {
			const r = await Effect.runPromise(getTasks());
			setTasks([...r.items]);
		} catch (e) {
			console.error("加载任务失败:", getErrorMessage(e));
		} finally {
			setLoading(false);
		}
	};

	const reloadStats = async () => {
		try {
			setStats(await Effect.runPromise(getTaskStats()));
		} catch (e) {
			console.error("获取统计失败:", getErrorMessage(e));
		}
	};

	onMount(() => { reload(); reloadStats(); });

	const add = async (req: CreateTaskRequest): Promise<Task | null> => {
		const temp = makeTemp(req);
		setTasks((p) => [temp, ...p]);
		try {
			const real = await Effect.runPromise(apiCreateTask(req));
			setTasks((p) => p.map((t) => (t.id === temp.id ? real : t)));
			return real;
		} catch (e) {
			console.error("创建任务失败:", getErrorMessage(e));
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

		const fn: Record<string, () => Promise<Task>> = {
			completed: () => Effect.runPromise(completeTask(id)),
			active: () => Effect.runPromise(activateTask(id)),
			archived: () => Effect.runPromise(archiveTask(id)),
			backlog: () => Effect.runPromise(moveToBacklog(id)),
		};
		try {
			const f = fn[newStatus];
			if (!f) throw new Error(`未知状态: ${newStatus}`);
			const updated = await f();
			setTasks((c) => c.map((t) => (t.id === id ? updated : t)));
			await reloadStats();
		} catch (e) {
			console.error("更新状态失败:", getErrorMessage(e));
			setTasks((c) => c.map((t) => (t.id === id ? { ...t, status: orig.status } : t)));
		}
	};

	const removeTask = async (id: number) => {
		if (!confirm("确定要删除这个任务吗？")) return;
		const prev = tasks();
		setTasks(prev.filter((t) => t.id !== id));
		try {
			await Effect.runPromise(apiDeleteTask(id));
		} catch (e) {
			console.error("删除任务失败:", getErrorMessage(e));
			await reload();
		}
	};

	const updateTask = async (id: number, updates: Partial<Task>) => {
		const prev = tasks();
		const idx = prev.findIndex((t) => t.id === id);
		if (idx === -1) return;
		const orig = prev[idx];
		setTasks(prev.map((t, i) => (i === idx ? { ...t, ...updates } : t)));
		try {
			const updated = await Effect.runPromise(apiUpdateTask(id, updates));
			setTasks((c) => c.map((t) => (t.id === id ? updated : t)));
			await reloadStats();
		} catch (e) {
			console.error("更新任务失败:", getErrorMessage(e));
			setTasks((c) => c.map((t) => (t.id === id ? orig : t)));
		}
	};

	const addSubTask = async (parentId: number, title: string) => {
		try {
			const real = await Effect.runPromise(apiCreateTask({ title, parent_task_id: parentId }));
			setTasks((p) => [...p, real]);
		} catch (e) {
			console.error("创建子任务失败:", getErrorMessage(e));
		}
	};

	const filterByStatus = async (status: string) => {
		try {
			let r: { readonly items: readonly Task[] };
			switch (status) {
				case "backlog": r = await Effect.runPromise(getBacklogTasks()); break;
				case "active": r = await Effect.runPromise(getActiveTasks()); break;
				case "completed": r = await Effect.runPromise(getCompletedTasks()); break;
				default: r = await Effect.runPromise(getAllTasks());
			}
			setTasks([...r.items]);
		} catch (e) {
			console.error("筛选失败:", getErrorMessage(e));
		}
	};

	const handleSearch = async (query: string) => {
		if (!query) { await reload(); return; }
		setLoading(true);
		try {
			const r = await Effect.runPromise(searchTasks(query));
			setTasks([...r.items]);
		} catch (e) {
			console.error("搜索失败:", getErrorMessage(e));
		} finally {
			setLoading(false);
		}
	};

	const ctx: TaskCtxValue = {
		tasks, loading, stats, add, reload, reloadStats,
		updateStatus, removeTask, updateTask, addSubTask,
		filterByStatus, search: handleSearch,
	};

	return <TaskCtx.Provider value={ctx}>{props.children}</TaskCtx.Provider>;
}

export function useTasks() {
	const ctx = useContext(TaskCtx);
	if (!ctx) throw new Error("useTasks must be used within <TaskProvider>");
	return ctx;
}
