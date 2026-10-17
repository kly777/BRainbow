import {
	confirmAndDelete,
	notifyError,
	notifyWarning,
	tryAsync,
} from "@shared/utils";
import {
	createContext,
	createSignal,
	type JSX,
	onMount,
	useContext,
} from "solid-js";
import type {
	CreateTaskRequest,
	Task,
	TaskSortKey,
	TaskStatusType,
} from "../api.ts";
import {
	createTaskE as apiCreateTask,
	deleteTaskE as apiDeleteTask,
	updateTaskE as apiUpdateTask,
	fetchAllTasks,
	getTaskStatsE,
	getTasksE,
	searchTasksE,
} from "../api.ts";
import {
	applyFilter,
	EMPTY_FILTER,
	type TaskFilter,
} from "../lib/task-filter.ts";
import { toUpdatePayload } from "../lib/task-payload.ts";
import { makeTemp, STATUS_API } from "../lib/task-provider-utils.ts";

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
	/** 排序口径（默认 smart）：列表视图的分组方式也跟着它走 */
	sort: () => TaskSortKey;
	setSort: (sort: TaskSortKey) => void;
	/** 筛选条件 + 改写；`tasks()` 返回的已是筛过的结果 */
	filter: () => TaskFilter;
	setFilter: (filter: TaskFilter) => void;
	add(req: CreateTaskRequest): Promise<Task | null>;
	reload(): Promise<void>;
	reloadStats(): Promise<void>;
	updateStatus(id: number, status: TaskStatusType): Promise<void>;
	removeTask(id: number): Promise<void>;
	updateTaskE(id: number, updates: Partial<Task>): Promise<void>;
	addSubTask(parentId: number, title: string): Promise<void>;
	/** 应用搜索词（来自 URL）：改词即重取，与 `reload` 走同一条加载路径 */
	setQuery(query: string): void;
}

const TaskCtx = createContext<TaskCtxValue>();

export function TaskProvider(props: { children: JSX.Element }) {
	// `allTasks` 是原样载入的全量（写路径的乐观更新落在它上面），
	// `tasks` 是**筛过**的结果 —— 界面一律读后者
	const [allTasks, setTasks] = createSignal<Task[]>([]);
	const [loading, setLoading] = createSignal(true);
	// 排序口径：默认 smart（系统算"先做哪件"），用户可在工具条切换
	const [sort, setSortSignal] = createSignal<TaskSortKey>("smart");
	// 筛选条件（客户端筛：全量已在内存里，见 lib/task-filter.ts 的说明）
	const [filter, setFilter] = createSignal<TaskFilter>(EMPTY_FILTER);
	const [stats, setStats] = createSignal<Stats>({
		backlog: 0,
		active: 0,
		completed: 0,
		archived: 0,
	});

	const tasks = () => applyFilter(allTasks(), filter());

	const setSort = (next: TaskSortKey) => {
		if (next === sort()) {
			return;
		}
		setSortSignal(next);
		void reload();
	};

	/**
	 * 当前搜索词。**它是加载口径的一部分**，所以归 provider 持有。
	 *
	 * 原先 `search(q)` 与 `reload()` 是两个各自发请求、各自 `setTasks` 的加载器，
	 * 于是有两类静默错：① 两者并发时，慢的那个最后落地 —— 全量响应盖掉搜索结果
	 * （实测：搜"zzzznotexist"接口返回 0 条，界面仍列着全部任务）；
	 * ② `reload()` 不带搜索词，所以"搜索状态下改个状态 / 换排序"会把列表变回全量。
	 * 收成一处之后只有 `load()` 一个写入者。
	 */
	const [query, setQuerySignal] = createSignal("");
	/** 最近一次发出的请求口径；响应回来时对不上就丢弃（overlapping 请求的老结果不许落地） */
	let requested: string | null = null;

	const load = async () => {
		const q = query();
		requested = q;
		setLoading(true);
		// 拉全量（后端分页缺省 20 条，只取第一页会让第 21 条起在界面上消失）
		const result = await tryAsync(() =>
			fetchAllTasks((page, size) =>
				q ? searchTasksE(q, page, size) : getTasksE(page, size, sort()),
			),
		);
		// 期间又发了新请求（输入框还在打字、或换了排序）→ 这次的结果已经过期
		if (requested !== q) {
			return;
		}
		if (result.ok) {
			setTasks(result.value.items);
			if (result.value.truncated) {
				notifyWarning(
					`${q ? "匹配" : "任务"}过多：只载入前 ${result.value.items.length} 条（共 ${result.value.total} 条）`,
				);
			}
		} else {
			notifyError("加载任务失败", result.error);
		}
		setLoading(false);
	};

	const reload = () => load();

	/** 搜索词来自 URL（TaskPanel 那个 effect）；改词即重取，且与 reload 共用同一条加载路径 */
	const setQuery = (next: string) => {
		if (next === query()) {
			return;
		}
		setQuerySignal(next);
		void load();
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
		// 失败：回滚乐观更新**并把原因说出来**。
		// 此前这里只回滚、不提示，于是创建失败（如标题超 255 被 400 拒）在界面上
		// 完全静默 —— 调用方（录入框）已经先把输入框清空了，用户既看不到原因、
		// 也找不回写的内容。等同于静默丢数据。
		setTasks((p) => p.filter((t) => t.id !== temp.id));
		notifyError("没能创建任务", result.error);
		return null;
	};

	const updateStatus = async (id: number, newStatus: TaskStatusType) => {
		const prev = tasks();
		const idx = prev.findIndex((t) => t.id === id);
		if (idx === -1) return;
		const orig = prev[idx];

		// 乐观更新
		setTasks(prev.map((t, i) => (i === idx ? { ...t, status: newStatus } : t)));

		const result = await tryAsync(() => STATUS_API[newStatus](id));
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
		const prev = tasks();
		setTasks(prev.filter((t) => t.id !== id));
		await confirmAndDelete({
			title: "删除任务",
			message: "确定要删除这个任务吗？子任务也会被一并删除。",
			deleteFn: () => apiDeleteTask(id),
			onError: () => void reload(),
		});
	};

	const updateTaskE = async (id: number, updates: Partial<Task>) => {
		const prev = tasks();
		const idx = prev.findIndex((t) => t.id === id);
		if (idx === -1) return;
		const orig = prev[idx];

		// 乐观更新
		setTasks(prev.map((t, i) => (i === idx ? { ...t, ...updates } : t)));

		// `Task.tags` 是对象数组、PATCH 要的是名字数组（整体替换语义）——
		// 转换走 lib/task-payload 的单点实现
		const result = await tryAsync(() =>
			apiUpdateTask(id, toUpdatePayload(updates)),
		);
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

	const ctx: TaskCtxValue = {
		tasks,
		loading,
		stats,
		sort,
		setSort,
		filter,
		setFilter,
		add,
		reload,
		reloadStats,
		updateStatus,
		removeTask,
		updateTaskE,
		addSubTask,
		setQuery,
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
			sort: () => "smart" as TaskSortKey,
			setSort: () => {},
			filter: () => EMPTY_FILTER,
			setFilter: () => {},
			add: async () => null,
			reload: async () => {},
			reloadStats: async () => {},
			updateStatus: async () => {},
			removeTask: async () => {},
			updateTaskE: async () => {},
			addSubTask: async () => {},
			setQuery: () => {},
		};
	}
	return ctx;
}
