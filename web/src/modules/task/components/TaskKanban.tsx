import { Button, Modal } from "@components/ui";
import type { Task } from "@modules/task";
import { useTasks } from "@modules/task";
import { fmtLocal } from "@shared/utils";
import { createMemo, createSignal, For, Show } from "solid-js";
import styles from "./TaskKanban.module.css";

// ==================== 状态常量 ====================

const COLUMNS = [
	{ key: "backlog", label: "待办" },
	{ key: "active", label: "进行中" },
	{ key: "completed", label: "已完成" },
] as const;

const STATUS_COLORS: Record<string, string> = {
	backlog: "var(--t-color-ink-muted)",
	active: "var(--t-color-accent)",
	completed: "var(--t-color-success)",
	archived: "var(--t-color-ink-faint)",
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
					<span class={styles.effortTag}>⏱ {t.effort_estimate_minutes}min</span>
				</Show>
				<span class={styles.cardDate}>{fmtLocal(t.created_at)}</span>
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
				<span class={styles.columnDot} aria-hidden="true" />
				<span class={styles.columnLabel}>{props.col.label}</span>
				<span class={styles.columnCount}>{props.tasks.length}</span>
			</div>
			<div class={styles.columnBody}>
				<Show
					when={props.tasks.length > 0}
					fallback={<div class={styles.emptyCol}>拖拽任务到此列</div>}
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
	const { tasks, updateStatus, updateTaskE } = useTasks();
	const [editingTask, setEditingTask] = createSignal<Task | null>(null);
	const [editTitle, setEditTitle] = createSignal("");

	// 按状态分组（排除 archived）
	const grouped = createMemo(() => {
		const map: Record<string, Task[]> = {
			backlog: [],
			active: [],
			completed: [],
		};
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

	const openEdit = (task: Task) => {
		setEditingTask(task);
		setEditTitle(task.title);
	};

	const closeEdit = () => {
		setEditingTask(null);
		setEditTitle("");
	};

	const saveEdit = async () => {
		const task = editingTask();
		const title = editTitle().trim();
		if (!task || !title || title === task.title) {
			closeEdit();
			return;
		}
		await updateTaskE(task.id, { title });
		closeEdit();
	};

	return (
		<>
			<div class={styles.board}>
				<For each={COLUMNS}>
					{(col) => (
						<Column
							col={col}
							tasks={grouped()[col.key]}
							onEdit={openEdit}
							onDrop={handleDrop}
						/>
					)}
				</For>
			</div>

			<Modal
				isOpen={editingTask() !== null}
				onClose={closeEdit}
				title="编辑任务标题"
				actions={
					<>
						<Button variant="secondary" onClick={closeEdit}>
							取消
						</Button>
						<Button
							variant="primary"
							onClick={saveEdit}
							disabled={!editTitle().trim()}
						>
							保存
						</Button>
					</>
				}
			>
				<input
					type="text"
					class={styles.editTitleInput}
					value={editTitle()}
					onInput={(e) => setEditTitle(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") void saveEdit();
					}}
					aria-label="任务标题"
				/>
			</Modal>
		</>
	);
}
