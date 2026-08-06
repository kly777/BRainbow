import { For } from "solid-js";
import type { Task } from "@features/task/types.ts";
import styles from "@features/task/ui/EditTaskModal.module.css";

interface BasicInfoTabProps {
	title: () => string;
	setTitle: (v: string) => void;
	description: () => string;
	setDescription: (v: string) => void;
	status: () => string;
	setStatus: (v: string) => void;
	effort: () => number | undefined;
	setEffort: (v: number | undefined) => void;
	parentTaskId: () => number | undefined;
	setParentTaskId: (v: number | undefined) => void;
	allTasks: Task[];
	currentTaskId: number | undefined;
}

export default function BasicInfoTab(props: BasicInfoTabProps) {
	return (
		<div class={styles.tabContent}>
			<div class={styles.field}>
				<label class={styles.fieldLabel} for="task-title">
					标题 *
				</label>
				<input
					id="task-title"
					type="text"
					value={props.title()}
					onInput={(e) => props.setTitle(e.currentTarget.value)}
					class={styles.fieldInput}
					required
					placeholder="输入任务标题"
				/>
			</div>

			<div class={styles.field}>
				<label class={styles.fieldLabel} for="task-desc">
					描述
				</label>
				<textarea
					id="task-desc"
					value={props.description()}
					onInput={(e) => props.setDescription(e.currentTarget.value)}
					class={styles.fieldTextarea}
					placeholder="输入任务描述"
					rows={3}
				/>
			</div>

			<div class={styles.fieldRow}>
				<div class={styles.field}>
					<label class={styles.fieldLabel} for="task-status">
						状态
					</label>
					<select
						id="task-status"
						value={props.status()}
						onChange={(e) => props.setStatus(e.currentTarget.value)}
						class={styles.fieldInput}
					>
						<option value="backlog">待办</option>
						<option value="active">进行中</option>
						<option value="completed">已完成</option>
						<option value="archived">归档</option>
					</select>
				</div>

				<div class={styles.field}>
					<label class={styles.fieldLabel} for="task-effort">
						预计工时（分钟）
					</label>
					<input
						id="task-effort"
						type="number"
						value={props.effort() ?? ""}
						onInput={(e) =>
							props.setEffort(
								e.currentTarget.value
									? parseInt(e.currentTarget.value, 10)
									: undefined,
							)
						}
						class={styles.fieldInput}
						min="0"
						placeholder="可选"
					/>
				</div>
			</div>

			<div class={styles.field}>
				<label class={styles.fieldLabel} for="task-parent">
					父任务
				</label>
				<select
					id="task-parent"
					value={props.parentTaskId() ?? ""}
					onChange={(e) =>
						props.setParentTaskId(
							e.currentTarget.value
								? parseInt(e.currentTarget.value, 10)
								: undefined,
						)
					}
					class={styles.fieldInput}
				>
					<option value="">无</option>
					<For
						each={props.allTasks.filter((t) => t.id !== props.currentTaskId)}
					>
						{(t) => <option value={t.id}>{t.title}</option>}
					</For>
				</select>
			</div>
		</div>
	);
}
