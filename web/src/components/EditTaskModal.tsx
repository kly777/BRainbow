import { Effect } from "effect";
import { createEffect, createSignal, For } from "solid-js";
import {
	createTimeWindow,
	deleteTimeWindow,
	getTimeWindows,
} from "@/apis/timeWindowApi";
import type { CreateTimeWindowRequest, Task, TimeWindow } from "@/apis/types";
import { showErrorAlert } from "@/apis/types";
import styles from "../pages/TaskManager.module.css";
import Modal from "./Modal";

interface EditTaskModalProps {
	isOpen: boolean;
	onClose: () => void;
	task: Task | null;
	allTasks: Task[];
	onSave: (taskId: number, updates: Partial<Task>) => void;
}

export default function EditTaskModal(props: EditTaskModalProps) {
	const [title, setTitle] = createSignal("");
	const [description, setDescription] = createSignal("");
	const [status, setStatus] = createSignal("");
	const [effort, setEffort] = createSignal<number | undefined>();
	const [parentTaskId, setParentTaskId] = createSignal<number | undefined>();
	const [userId, setUserId] = createSignal<number | undefined>();
	const [feasibleWindows, setFeasibleWindows] = createSignal<TimeWindow[]>([]);
	const [plannedWindows, setPlannedWindows] = createSignal<TimeWindow[]>([]);
	const [newStartTime, setNewStartTime] = createSignal("");
	const [newEndTime, setNewEndTime] = createSignal("");
	const [newWindowType, setNewWindowType] = createSignal<
		"feasible" | "planned"
	>("feasible");

	const loadTimeWindows = async () => {
		if (!props.task) return;
		try {
			const [feasible, planned] = await Promise.all([
				Effect.runPromise(getTimeWindows(props.task.id, "feasible")),
				Effect.runPromise(getTimeWindows(props.task.id, "planned")),
			]);
			setFeasibleWindows([...feasible]);
			setPlannedWindows([...planned]);
		} catch (error) {
			console.error("加载时间窗口失败:", error);
			showErrorAlert(error, "加载时间窗口失败");
		}
	};

	// 当任务变化时，更新表单值
	createEffect(() => {
		if (props.task) {
			setTitle(props.task.title);
			setDescription(props.task.description || "");
			setStatus(props.task.status || "backlog");
			setEffort(props.task.effort_estimate_minutes || undefined);
			setParentTaskId(props.task.parent_task_id || undefined);
			setUserId(props.task.user_id || undefined);
			loadTimeWindows();
		}
	});

	const handleSave = (e: Event) => {
		e.preventDefault();
		if (!props.task) return;

		const updates: Partial<Task> = {
			title: title(),
			description: description() || null,
			status: status(),
			effort_estimate_minutes: effort() || null,
			parent_task_id: parentTaskId() || null,
			user_id: userId() || null,
		};

		props.onSave(props.task.id, updates);
		props.onClose();
	};

	const handleAddTimeWindow = async () => {
		if (!props.task || !newStartTime() || !newEndTime()) return;
		const req: CreateTimeWindowRequest = {
			start_time: new Date(newStartTime()).toISOString(),
			end_time: new Date(newEndTime()).toISOString(),
			window_type: newWindowType(),
			task_id: props.task.id,
		};
		try {
			const tw = await Effect.runPromise(createTimeWindow(req));
			if (tw.window_type === "feasible") {
				setFeasibleWindows([...feasibleWindows(), tw]);
			} else {
				setPlannedWindows([...plannedWindows(), tw]);
			}
			setNewStartTime("");
			setNewEndTime("");
		} catch (error) {
			console.error("创建时间窗口失败:", error);
			showErrorAlert(error, "创建时间窗口失败");
		}
	};

	const handleDeleteTimeWindow = async (id: number, type: string) => {
		try {
			await Effect.runPromise(deleteTimeWindow(id));
			if (type === "feasible") {
				setFeasibleWindows(feasibleWindows().filter((w) => w.id !== id));
			} else {
				setPlannedWindows(plannedWindows().filter((w) => w.id !== id));
			}
		} catch (error) {
			console.error("删除时间窗口失败:", error);
			showErrorAlert(error, "删除时间窗口失败");
		}
	};

	return (
		<Modal
			isOpen={props.isOpen}
			onClose={props.onClose}
			title="编辑任务"
			actions={
				<>
					<button
						type="button"
						onClick={props.onClose}
						class={styles.cancelButton}
					>
						取消
					</button>
					<button
						type="button"
						onClick={handleSave}
						class={styles.submitButton}
					>
						保存
					</button>
				</>
			}
		>
			<form onSubmit={handleSave} class={styles.form}>
				<div class={styles.formGroup}>
					<label for="task-title" class={styles.label}>
						标题 *
					</label>
					<input
						id="task-title"
						type="text"
						value={title()}
						onInput={(e) => setTitle(e.currentTarget.value)}
						class={styles.input}
						required
						placeholder="输入任务标题"
					/>
				</div>

				<div class={styles.formGroup}>
					<label for="task-description" class={styles.label}>
						描述
					</label>
					<textarea
						id="task-description"
						value={description()}
						onInput={(e) => setDescription(e.currentTarget.value)}
						class={styles.textarea}
						placeholder="输入任务描述"
						rows={3}
					/>
				</div>

				<div class={styles.formGroup}>
					<label for="task-status" class={styles.label}>
						状态
					</label>
					<select
						id="task-status"
						value={status()}
						onChange={(e) => setStatus(e.currentTarget.value)}
						class={styles.input}
					>
						<option value="backlog">待办列表</option>
						<option value="active">进行中</option>
						<option value="completed">已完成</option>
						<option value="archived">已归档</option>
					</select>
				</div>

				<div class={styles.formGroup}>
					<label for="task-effort" class={styles.label}>
						预计工时（分钟）
					</label>
					<input
						id="task-effort"
						type="number"
						value={effort() ?? ""}
						onInput={(e) =>
							setEffort(
								e.currentTarget.value
									? parseInt(e.currentTarget.value, 10)
									: undefined,
							)
						}
						class={styles.input}
						min="0"
						placeholder="可选"
					/>
				</div>

				<div class={styles.formGroup}>
					<label for="task-parent" class={styles.label}>
						父任务
					</label>
					<select
						id="task-parent"
						value={parentTaskId() ?? ""}
						onChange={(e) =>
							setParentTaskId(
								e.currentTarget.value
									? parseInt(e.currentTarget.value, 10)
									: undefined,
							)
						}
						class={styles.input}
					>
						<option value="">无</option>
						<For each={props.allTasks.filter((t) => t.id !== props.task?.id)}>
							{(task) => (
								<option value={task.id.toString()}>{task.title}</option>
							)}
						</For>
					</select>
				</div>

				<div class={styles.formGroup}>
					<label for="task-user" class={styles.label}>
						用户ID
					</label>
					<input
						id="task-user"
						type="number"
						value={userId() ?? ""}
						onInput={(e) =>
							setUserId(
								e.currentTarget.value
									? parseInt(e.currentTarget.value, 10)
									: undefined,
							)
						}
						class={styles.input}
						placeholder="可选"
					/>
				</div>

				{/* 时间窗口管理 */}
				<div class={styles.formGroup}>
					<span class={styles.label}>可进行时间段</span>
					<div class={styles.timeWindowList}>
						<For each={feasibleWindows()}>
							{(tw) => (
								<div class={styles.timeWindowItem}>
									<span class={styles.timeWindowText}>
										{new Date(tw.start_time).toLocaleString("zh-CN", {
											month: "2-digit",
											day: "2-digit",
											hour: "2-digit",
											minute: "2-digit",
										})}
										{" ~ "}
										{new Date(tw.end_time).toLocaleString("zh-CN", {
											month: "2-digit",
											day: "2-digit",
											hour: "2-digit",
											minute: "2-digit",
										})}
									</span>
									<button
										type="button"
										onClick={() => handleDeleteTimeWindow(tw.id, "feasible")}
										class={styles.timeWindowDelete}
									>
										×
									</button>
								</div>
							)}
						</For>
					</div>
				</div>

				<div class={styles.formGroup}>
					<span class={styles.label}>计划进行时间段</span>
					<div class={styles.timeWindowList}>
						<For each={plannedWindows()}>
							{(tw) => (
								<div class={styles.timeWindowItem}>
									<span class={styles.timeWindowText}>
										{new Date(tw.start_time).toLocaleString("zh-CN", {
											month: "2-digit",
											day: "2-digit",
											hour: "2-digit",
											minute: "2-digit",
										})}
										{" ~ "}
										{new Date(tw.end_time).toLocaleString("zh-CN", {
											month: "2-digit",
											day: "2-digit",
											hour: "2-digit",
											minute: "2-digit",
										})}
									</span>
									<button
										type="button"
										onClick={() => handleDeleteTimeWindow(tw.id, "planned")}
										class={styles.timeWindowDelete}
									>
										×
									</button>
								</div>
							)}
						</For>
					</div>
				</div>

				<div class={styles.formGroup}>
					<span class={styles.label}>添加时间段</span>
					<div class={styles.timeWindowAddRow}>
						<select
							value={newWindowType()}
							onChange={(e) =>
								setNewWindowType(
									e.currentTarget.value as "feasible" | "planned",
								)
							}
							class={styles.timeWindowTypeSelect}
						>
							<option value="feasible">可进行</option>
							<option value="planned">计划</option>
						</select>
						<input
							type="datetime-local"
							value={newStartTime()}
							onInput={(e) => setNewStartTime(e.currentTarget.value)}
							class={styles.timeWindowInput}
						/>
						<span class={styles.timeWindowSep}>~</span>
						<input
							type="datetime-local"
							value={newEndTime()}
							onInput={(e) => setNewEndTime(e.currentTarget.value)}
							class={styles.timeWindowInput}
						/>
						<button
							type="button"
							onClick={handleAddTimeWindow}
							disabled={!newStartTime() || !newEndTime()}
							class={styles.timeWindowAddBtn}
						>
							添加
						</button>
					</div>
				</div>
			</form>
		</Modal>
	);
}
