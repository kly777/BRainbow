import { Select } from "@components/ui";
import { getErrorMessage } from "@shared/api";
import { notifyError, tryAsync } from "@shared/utils";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import type { Task } from "../api.ts";
import {
	addTaskDependencyE,
	getTaskDetailE,
	removeTaskDependencyE,
} from "../api.ts";
import styles from "./EditTaskModal.module.css";

// 依赖状态类映射（vanilla-extract 不支持动态索引）
const depStatusClass: Record<string, string> = {
	backlog: styles.depStatusBacklog,
	active: styles.depStatusActive,
	completed: styles.depStatusCompleted,
	archived: styles.depStatusArchived,
};

interface DependenciesTabProps {
	task: Task;
	allTasks: Task[];
	onDependencyChange?: () => void;
}

const DepItem = (props: {
	t: Task;
	onRemove: (id: number) => void | Promise<void>;
}) => (
	<div class={styles.depItem}>
		<div class={styles.depInfo}>
			<span class={styles.depTitle}>{props.t.title}</span>
			<span
				class={`${styles.depStatus} ${
					depStatusClass[props.t.status || "backlog"]
				}`}
			>
				{props.t.status || "backlog"}
			</span>
		</div>
		<button
			type="button"
			onClick={() => props.onRemove(props.t.id)}
			class={styles.depRemove}
			title="移除依赖"
		>
			×
		</button>
	</div>
);

const DepOptions = (props: { tasks: Task[] }) => (
	<For each={props.tasks}>
		{(t) => (
			<option value={t.id}>
				[{t.status || "backlog"}] {t.title}
			</option>
		)}
	</For>
);

export default function DependenciesTab(props: DependenciesTabProps) {
	const [depIds, setDepIds] = createSignal<number[]>([]);
	const [newDepId, setNewDepId] = createSignal<number | undefined>();
	const [error, setError] = createSignal("");

	// 加载详情（含依赖）
	const [detail] = createResource(
		() => props.task.id,
		async (taskId: number) => {
			const d = await getTaskDetailE(taskId);
			return d;
		},
	);

	// 同步依赖 id（唯一状态源）
	createEffect(() => {
		const d = detail();
		if (d) setDepIds([...d.depends_on]);
	});

	// 依赖任务对象由 allTasks × depIds 派生 —— 原先另存一份 depTasks 信号，
	// 增删两处都要记得改，漏一处就出现"id 变了、列表没变"
	const depTasks = createMemo(() =>
		depIds()
			.map((id) => props.allTasks.find((t) => t.id === id))
			.filter((t): t is Task => !!t),
	);

	// ── 可选依赖任务列表（排除自身和已有依赖） ──
	const availableDepTasks = () =>
		props.allTasks.filter(
			(t) => t.id !== props.task.id && !depIds().includes(t.id),
		);

	const handleAdd = async () => {
		const depId = newDepId();
		if (!depId) return;
		if (depIds().includes(depId)) {
			setError("该依赖已存在");
			return;
		}
		setError("");
		const result = await tryAsync(() =>
			addTaskDependencyE(props.task.id, depId),
		);
		if (result.ok) {
			setDepIds([...depIds(), depId]);
			setNewDepId(undefined);
			props.onDependencyChange?.();
		} else {
			const msg = getErrorMessage(result.error);
			setError(
				msg.includes("Circular")
					? "不能形成循环依赖"
					: msg.includes("self")
						? "不能依赖自己"
						: `添加失败: ${msg}`,
			);
		}
	};

	const handleRemove = async (depId: number) => {
		const result = await tryAsync(() =>
			removeTaskDependencyE(props.task.id, depId),
		);
		if (result.ok) {
			setDepIds(depIds().filter((id) => id !== depId));
			props.onDependencyChange?.();
		} else {
			notifyError("删除依赖失败", result.error);
		}
	};

	return (
		<div class={styles.tabContent}>
			<Show when={detail.error}>
				<div class={styles.errorMsg}>
					加载详情失败: {getErrorMessage(detail.error)}
				</div>
			</Show>

			{/* 已有依赖 */}
			<div class={styles.sectionHeader}>
				<span class={styles.sectionTitle}>当前依赖</span>
				<span class={styles.sectionHint}>（本任务依赖以下任务完成）</span>
			</div>
			<Show
				when={depTasks().length > 0}
				fallback={<div class={styles.emptyMsg}>暂无依赖关系</div>}
			>
				<div class={styles.depList}>
					<For each={depTasks()}>
						{(t) => <DepItem t={t} onRemove={handleRemove} />}
					</For>
				</div>
			</Show>

			{/* 添加依赖 */}
			<div class={styles.addDepBlock}>
				<div class={styles.sectionHeader}>
					<span class={styles.sectionTitle}>添加依赖</span>
				</div>
				<div class={styles.addDepRow}>
					<Select
						value={newDepId() ?? ""}
						onChange={(e) => {
							setNewDepId(
								e.currentTarget.value
									? parseInt(e.currentTarget.value, 10)
									: undefined,
							);
							setError("");
						}}
						aria-label="选择依赖任务"
					>
						<option value="">选择要依赖的任务...</option>
						<DepOptions tasks={availableDepTasks()} />
					</Select>
					<button
						type="button"
						onClick={handleAdd}
						disabled={!newDepId()}
						class={styles.addBtn}
					>
						+ 添加
					</button>
				</div>
				<Show when={error()}>
					<div class={styles.errorMsg}>{error()}</div>
				</Show>
			</div>
		</div>
	);
}
