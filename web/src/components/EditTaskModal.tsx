import { createEffect, createSignal, For, Show } from "solid-js";
import type { Task } from "@/apis/types";
import styles from "../pages/TaskManager.module.css"
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

	// 当任务变化时，更新表单值
	createEffect(() => {
		if (props.task) {
			setTitle(props.task.title);
			setDescription(props.task.description || "");
			setStatus(props.task.status || "backlog");
			setEffort(props.task.effort_estimate_minutes || undefined);
			setParentTaskId(props.task.parent_task_id || undefined);
			setUserId(props.task.user_id || undefined);
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
			</form>
		</Modal>
	);
}
