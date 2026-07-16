import {
	createEffect,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import {
	addTaskDependencyE,
	getTaskDetailE,
	removeTaskDependencyE,
} from "../../../apis/taskApi.ts";
import type { Task } from "../../../apis/types/index.ts";
import { getErrorMessage } from "../../../apis/types/index.ts";
import styles from "./EditTaskModal.module.css";

interface DependenciesTabProps {
	task: Task;
	allTasks: Task[];
	onDependencyChange?: () => void;
}

export default function DependenciesTab(props: DependenciesTabProps) {
	const [depIds, setDepIds] = createSignal<number[]>([]);
	const [depTasks, setDepTasks] = createSignal<Task[]>([]);
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

	// 同步依赖
	createEffect(() => {
		const d = detail();
		if (d) {
			setDepIds([...d.depends_on]);
			// 从 allTasks 查找完整 task 对象
			const found = d.depends_on
				.map((id) => props.allTasks.find((t) => t.id === id))
				.filter((t): t is Task => !!t);
			setDepTasks(found);
		}
	});

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
		try {
			await addTaskDependencyE(props.task.id, depId);
			const depTask = props.allTasks.find((t) => t.id === depId);
			setDepIds([...depIds(), depId]);
			if (depTask) setDepTasks([...depTasks(), depTask]);
			setNewDepId(undefined);
			props.onDependencyChange?.();
		} catch (e) {
			const msg = getErrorMessage(e);
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
		try {
			await removeTaskDependencyE(props.task.id, depId);
			setDepIds(depIds().filter((id) => id !== depId));
			setDepTasks(depTasks().filter((t) => t.id !== depId));
			props.onDependencyChange?.();
		} catch (e) {
			console.error("删除依赖失败:", getErrorMessage(e));
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
						{(t) => (
							<div class={styles.depItem}>
								<div class={styles.depInfo}>
									<span class={styles.depTitle}>{t.title}</span>
									<span
										class={`${styles.depStatus} ${
											styles[`depStatus_${t.status || "backlog"}`]
										}`}
									>
										{t.status || "backlog"}
									</span>
								</div>
								<button
									type="button"
									onClick={() => handleRemove(t.id)}
									class={styles.depRemove}
									title="移除依赖"
								>
									×
								</button>
							</div>
						)}
					</For>
				</div>
			</Show>

			{/* 添加依赖 */}
			<div class={styles.addDepBlock}>
				<div class={styles.sectionHeader}>
					<span class={styles.sectionTitle}>添加依赖</span>
				</div>
				<div class={styles.addDepRow}>
					<select
						value={newDepId() ?? ""}
						onChange={(e) => {
							setNewDepId(
								e.currentTarget.value
									? parseInt(e.currentTarget.value, 10)
									: undefined,
							);
							setError("");
						}}
						class={styles.fieldInput}
					>
						<option value="">选择要依赖的任务...</option>
						<For each={availableDepTasks()}>
							{(t) => (
								<option value={t.id}>
									[{t.status || "backlog"}] {t.title}
								</option>
							)}
						</For>
					</select>
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
