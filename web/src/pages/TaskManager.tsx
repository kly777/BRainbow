import { createSignal, Show } from "solid-js";
import type { CreateTaskRequest } from "../apis/types/index.ts";
import TaskCalendar from "../components/task/TaskCalendar.tsx";
import TaskDag from "../components/task/TaskDag.tsx";
import TaskKanban from "../components/task/TaskKanban.tsx";
import TaskList from "../components/task/TaskList.tsx";
import { TaskProvider, useTasks } from "../components/task/TaskProvider.tsx";
import styles from "./TaskManager.module.css";

function StatsBar() {
	const { stats } = useTasks();
	const items = [
		{ key: "backlog", label: "待办" },
		{ key: "active", label: "进行中" },
		{ key: "completed", label: "已完成" },
		{ key: "archived", label: "已归档" },
	] as const;

	return (
		<div class={styles.statsGrid}>
			{items.map(({ key, label }) => (
				<div class={styles.statCard}>
					<div class={styles.statValue}>{stats()[key]}</div>
					<div class={styles.statLabel}>{label}</div>
				</div>
			))}
		</div>
	);
}

function SearchBar() {
	const { search } = useTasks();
	const [q, setQ] = createSignal("");

	return (
		<div class={styles.searchBar}>
			<input type="text" placeholder="搜索任务标题..." value={q()} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && search(q())} class={styles.searchInput} />
			<button type="button" onClick={() => search(q())} class={styles.searchButton}>搜索</button>
		</div>
	);
}

function QuickCreate() {
	const { add } = useTasks();
	const [title, setTitle] = createSignal("");

	const submit = async () => {
		const t = title().trim();
		if (!t) return;
		setTitle("");
		await add({ title: t });
	};

	return (
		<div class={styles.quickCreate}>
			<input type="text" placeholder="快速创建任务，按Enter..." value={title()} onInput={(e) => setTitle(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && submit()} class={styles.quickInput} />
		</div>
	);
}

function FilterBar() {
	const { reload, filterByStatus } = useTasks();
	const [active, setActive] = createSignal("all");

	const filters = [
		{ key: "all", label: "全部", action: reload },
		{ key: "backlog", label: "待办", action: () => filterByStatus("backlog") },
		{ key: "active", label: "进行中", action: () => filterByStatus("active") },
		{ key: "completed", label: "已完成", action: () => filterByStatus("completed") },
	];

	return (
		<div class={styles.filterBar}>
			{filters.map(({ key, label, action }) => (
				<button type="button" class={`${styles.filterBtn} ${active() === key ? styles.filterActive : ""}`} onClick={() => { setActive(key); action(); }}>
					{label}
				</button>
			))}
		</div>
	);
}

function CreateModal(props: { open: boolean; onClose: () => void }) {
	const { add } = useTasks();
	const [title, setTitle] = createSignal("");
	const [desc, setDesc] = createSignal("");
	const [effort, setEffort] = createSignal<number | undefined>();

	const submit = async (e: Event) => {
		e.preventDefault();
		const t = title().trim();
		if (!t) return;
		const req: CreateTaskRequest = { title: t, description: desc().trim() || undefined, effort_estimate_minutes: effort() };
		await add(req);
		setTitle("");
		setDesc("");
		setEffort(undefined);
		props.onClose();
	};

	return (
		<Show when={props.open}>
			<div class={styles.modalOverlay} onClick={props.onClose} onKeyUp={(e) => e.key === "Escape" && props.onClose()} role="dialog" aria-modal="true">
				<div class={styles.modal} onClick={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()} role="document">
					<h2 class={styles.modalTitle}>创建新任务</h2>
					<form onSubmit={submit} class={styles.form}>
						<div class={styles.formGroup}>
							<label for="task-title" class={styles.label}>标题 *</label>
							<input id="task-title" type="text" value={title()} onInput={(e) => setTitle(e.currentTarget.value)} class={styles.input} required placeholder="输入任务标题" />
						</div>
						<div class={styles.formGroup}>
							<label for="task-desc" class={styles.label}>描述</label>
							<textarea id="task-desc" value={desc()} onInput={(e) => setDesc(e.currentTarget.value)} class={styles.textarea} placeholder="输入任务描述" rows={3} />
						</div>
						<div class={styles.formGroup}>
							<label for="task-effort" class={styles.label}>预计工时（分钟）</label>
							<input id="task-effort" type="number" value={effort() ?? ""} onInput={(e) => setEffort(e.currentTarget.value ? parseInt(e.currentTarget.value, 10) : undefined)} class={styles.input} min="0" placeholder="可选" />
						</div>
						<div class={styles.formActions}>
							<button type="button" onClick={props.onClose} class={styles.cancelButton}>取消</button>
							<button type="submit" class={styles.submitButton}>创建</button>
						</div>
					</form>
				</div>
			</div>
		</Show>
	);
}

function TaskPanel() {
	const { tasks, loading, updateStatus, removeTask, updateTask, addSubTask } = useTasks();
	const [viewMode, setViewMode] = createSignal<"list" | "kanban">("list");
	const [rightTab, setRightTab] = createSignal<"calendar" | "dag">("calendar");

	return (
		<Show when={loading()} fallback={
			<>
				{/* 视图切换 */}
				<div class={styles.viewSwitch}>
					<button
						type="button"
						class={`${styles.viewBtn} ${viewMode() === "list" ? styles.viewActive : ""}`}
						onClick={() => setViewMode("list")}
					>
						📋 列表
					</button>
					<button
						type="button"
						class={`${styles.viewBtn} ${viewMode() === "kanban" ? styles.viewActive : ""}`}
						onClick={() => setViewMode("kanban")}
					>
						📌 看板
					</button>
				</div>

				{/* 列表视图 */}
				<Show when={viewMode() === "list"}>
					<div class={styles.splitView}>
						<TaskList tasks={tasks()} onStatusChange={updateStatus} onDelete={removeTask} onUpdate={updateTask} onAddSubTask={addSubTask} />
						<div class={styles.rightPanel}>
							<div class={styles.tabBar}>
								<button
									type="button"
									class={`${styles.tabBtn} ${rightTab() === "calendar" ? styles.tabActive : ""}`}
									onClick={() => setRightTab("calendar")}
								>
									📅 日历
								</button>
								<button
									type="button"
									class={`${styles.tabBtn} ${rightTab() === "dag" ? styles.tabActive : ""}`}
									onClick={() => setRightTab("dag")}
								>
									🔗 依赖图
								</button>
							</div>
							<Show when={rightTab() === "calendar"}>
								<TaskCalendar />
							</Show>
							<Show when={rightTab() === "dag"}>
								<TaskDag />
							</Show>
						</div>
					</div>
				</Show>

				{/* 看板视图 */}
				<Show when={viewMode() === "kanban"}>
					<TaskKanban />
				</Show>
			</>
		}>
			<div class={styles.loading}>加载中...</div>
		</Show>
	);
}

export default function TaskManager() {
	const [showModal, setShowModal] = createSignal(false);

	return (
		<TaskProvider>
			<div class={styles.taskManager}>
				<div class={styles.header}>
					<h1>时间管理</h1>
					<div class={styles.actions}>
						<button type="button" class={styles.createButton} onClick={() => setShowModal(true)}>+ 新建任务</button>
					</div>
				</div>

				<SearchBar />
				<StatsBar />
				<QuickCreate />
				<FilterBar />
				<TaskPanel />
				<CreateModal open={showModal()} onClose={() => setShowModal(false)} />
			</div>
		</TaskProvider>
	);
}
