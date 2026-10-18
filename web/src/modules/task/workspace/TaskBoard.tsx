// ── 看板：三列拖拽，卡片只负责打开详情 ──

import { For, Show, createMemo } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fillPath, PATHS } from "@config/paths";
import type { Task } from "../api.ts";
import type { TaskStatusType } from "../api-types.ts";
import { statusToken } from "../lib/status-colors.ts";
import { TaskMeta } from "../components/TaskMeta.tsx";
import { useTasks } from "../components/TaskProvider.tsx";
import styles from "./TaskBoard.module.css";

const COLUMNS = [
	{ key: "backlog", label: "待办", hint: "拖到这里排队" },
	{ key: "active", label: "进行中", hint: "拖到这里开始做" },
	{ key: "completed", label: "已完成", hint: "拖到这里收尾" },
] as const;

const statusColor = (status: string) => `var(${statusToken(status)})`;

export interface TaskBoardProps {
	onSelect?: (taskId: number) => void;
}

export default function TaskBoard(props: TaskBoardProps) {
	const { tasks, updateStatus } = useTasks();
	const navigate = useNavigate();

	const open = (taskId: number) => {
		if (props.onSelect) props.onSelect(taskId);
		else navigate(fillPath(PATHS.taskDetail, taskId));
	};

	const grouped = createMemo(() => {
		const map: Record<string, Task[]> = {
			backlog: [],
			active: [],
			completed: [],
		};
		for (const task of tasks()) {
			if (task.status === "archived") continue;
			(map[task.status] ?? map.backlog).push(task);
		}
		return map;
	});
	const parentById = createMemo(
		() => new Map(tasks().map((task) => [task.id, task])),
	);

	const drop = (taskId: number, status: TaskStatusType) => {
		const task = tasks().find((item) => item.id === taskId);
		if (!task || task.status === status) return;
		void updateStatus(taskId, status);
	};

	return (
		<div class={styles.board}>
			<For each={COLUMNS}>
				{(column) => (
					<section
						class={styles.column}
						style={`--column-color: ${statusColor(column.key)}`}
						onDragOver={(e) => {
							e.preventDefault();
							if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
						}}
						onDrop={(e) => {
							e.preventDefault();
							const id = Number(e.dataTransfer?.getData("text/plain"));
							if (Number.isInteger(id) && id > 0) drop(id, column.key);
						}}
					>
						<header class={styles.columnHead}>
							<span class={styles.dot} />
							<h2 class={styles.columnTitle}>{column.label}</h2>
							<span class={styles.count}>{grouped()[column.key].length}</span>
						</header>
						<div class={styles.cards}>
							<Show
								when={grouped()[column.key].length > 0}
								fallback={<p class={styles.empty}>{column.hint}</p>}
							>
								<For each={grouped()[column.key]}>
									{(task) => (
										<article
											class={styles.card}
											draggable="true"
											tabindex={0}
											role="button"
											aria-label={`打开任务：${task.title}`}
											onDragStart={(e) => {
												e.dataTransfer?.setData("text/plain", String(task.id));
												if (e.dataTransfer)
													e.dataTransfer.effectAllowed = "move";
											}}
											onClick={() => open(task.id)}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") {
													e.preventDefault();
													open(task.id);
												}
											}}
										>
											<div class={styles.cardHead}>
												<Show when={task.parent_task_id}>
													<span class={styles.subBadge}>子</span>
												</Show>
												<h3 class={styles.cardTitle}>{task.title}</h3>
												<span class={styles.cardId}>#{task.id}</span>
											</div>
											<Show when={task.parent_task_id}>
												<span class={styles.cardParent}>
													父：
													{parentById().get(task.parent_task_id as number)
														?.title ?? `#${task.parent_task_id}`}
												</span>
											</Show>
											<Show when={task.description}>
												<p class={styles.cardDesc}>{task.description}</p>
											</Show>
											<TaskMeta task={task} class={styles.cardMeta} />
										</article>
									)}
								</For>
							</Show>
						</div>
					</section>
				)}
			</For>
		</div>
	);
}
