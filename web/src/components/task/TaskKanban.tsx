import { createMemo, For, Show } from "solid-js";
import type { Task } from "../../apis/types/index.ts";
import { useTasks } from "./TaskProvider.tsx";
import styles from "./TaskKanban.module.css";

// ==================== 状态常量 ====================

const COLUMNS = [
	{ key: "backlog", label: "待办", icon: "📋" },
	{ key: "active", label: "进行中", icon: "🚀" },
	{ key: "completed", label: "已完成", icon: "✅" },
] as const;

const STATUS_COLORS: Record<string, string> = {
	backlog: "#6b7280",
	active: "#3b82f6",
	completed: "#10b981",
	archived: "#9ca3af",
};

// ==================== 拖拽卡片 ====================

interface KanbanCardProps {
	task: Task;
	onEdit: () => void;
	dragId: string;
}

function KanbanCard(props: KanbanCardProps) {
	const t = props.task;
	const isSub = !!t.parent_task_id;

	const onDragStart = (e: DragEvent) => {
		e.dataTransfer?.setData("text/plain", props.dragId);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
	};

	return (
		<button
			type="button"
			class={styles.card}
			draggable="true"
			onDragStart={onDragStart}
			onClick={props.onEdit}
		>
			<div class={styles.cardTitle}>
				<Show when={isSub}>
					<span class={styles.subBadge}>子</span>
				</Show>
				<span class={styles.cardTitleText}>{t.title}</span>
			</div>
			<Show when={t.description}>
				<p class={styles.cardDesc}>{t.description?.slice(0, 80)}</p>
			</Show>
			<div class={styles.cardMeta}>
				<Show when={t.effort_estimate_minutes}>
					<span class={styles.effortTag}>
						⏱ {t.effort_estimate_minutes}min
					</span>
				</Show>
				<span class={styles.cardDate}>
					{new Date(t.created_at).toLocaleDateString("zh-CN", {
						month: "short",
						day: "numeric",
					})}
				</span>
			</div>
		</button>
	);
}

// ==================== 列 ====================

interface ColumnProps {
	col: (typeof COLUMNS)[number];
	tasks: Task[];
	onEdit: (task: Task) => void;
	onDrop: (taskId: number, newStatus: string) => void;
}

function Column(props: ColumnProps) {
	const color = STATUS_COLORS[props.col.key];

	const onDragOver = (e: DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
	};

	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		const taskId = parseInt(e.dataTransfer?.getData("text/plain") ?? "", 10);
		if (!Number.isNaN(taskId)) {
			props.onDrop(taskId, props.col.key);
		}
	};

	return (
		<fieldset
			class={styles.column}
			aria-label={props.col.label}
			onDragOver={onDragOver}
			onDrop={onDrop}
			style={{ "--col-color": color }}
		>
			<div class={styles.columnHeader}>
				<span class={styles.columnIcon}>{props.col.icon}</span>
				<span class={styles.columnLabel}>{props.col.label}</span>
				<span class={styles.columnCount}>{props.tasks.length}</span>
			</div>
			<div class={styles.columnBody}>
				<Show
					when={props.tasks.length > 0}
					fallback={
						<div class={styles.emptyCol}>拖拽任务到此列</div>
					}
				>
					<For each={props.tasks}>
						{(task) => (
							<KanbanCard
								task={task}
								onEdit={() => props.onEdit(task)}
								dragId={String(task.id)}
							/>
						)}
					</For>
				</Show>
			</div>
		</fieldset>
	);
}

// ==================== 主组件 ====================

export default function TaskKanban() {
	const { tasks, updateStatus, updateTask } = useTasks();

	// 按状态分组（排除 archived）
	const grouped = createMemo(() => {
		const map: Record<string, Task[]> = { backlog: [], active: [], completed: [] };
		for (const t of tasks()) {
			if (t.status === "archived") continue;
			const key = t.status || "backlog";
			if (map[key]) map[key].push(t);
		}
		return map;
	});

	const handleDrop = async (taskId: number, newStatus: string) => {
		const task = tasks().find((t) => t.id === taskId);
		if (!task || task.status === newStatus) return;
		await updateStatus(taskId, newStatus);
	};

	const handleEdit = (task: Task) => {
		// 简单内联编辑：通过 updateTask 打开编辑模态
		// 这里用一个简单的方式 —— console 输出提示
		const newTitle = prompt("编辑标题", task.title);
		if (newTitle?.trim() && newTitle !== task.title) {
			updateTask(task.id, { title: newTitle.trim() });
		}
	};

	return (
		<div class={styles.board}>
			<For each={COLUMNS}>
				{(col) => (
					<Column
						col={col}
						tasks={grouped()[col.key]}
						onEdit={handleEdit}
						onDrop={handleDrop}
					/>
				)}
			</For>
		</div>
	);
}
