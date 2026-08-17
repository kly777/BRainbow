// ── /task/:id：任务详情（全局搜索直达） ──

import { Button, Toolbar } from "@components/ui";
import { fillPath, PATHS } from "@config/paths";
import { getErrorMessage } from "@lib/api";
import { fmtLocal, notifySuccess, showConfirm, tryOrNotify } from "@lib/utils";
import {
	deleteTaskE,
	getAllTasksE,
	getTaskDetailE,
	type Task,
	updateTaskE,
} from "@modules/task";
import { A, useNavigate, useParams } from "@solidjs/router";
import { createResource, createSignal, For, Show } from "solid-js";
import EditTaskModal from "./components/EditTaskModal.tsx";
import styles from "./TaskDetail.module.css";

const STATUS_LABEL: Record<string, string> = {
	backlog: "待办",
	active: "进行中",
	completed: "已完成",
	archived: "已归档",
};

export default function TaskDetail() {
	const params = useParams();
	const navigate = useNavigate();
	const id = () => Number(params.id);

	const [detail, { refetch }] = createResource(id, (v) => {
		if (!Number.isInteger(v) || v < 1) throw new Error("无效的任务 ID");
		return getTaskDetailE(v);
	});
	const [allTasks] = createResource(async () => {
		const result = await getAllTasksE();
		return [...result.items];
	});

	const [editing, setEditing] = createSignal(false);

	const save = async (taskId: number, updates: Partial<Task>) => {
		const ok = await tryOrNotify(
			() => updateTaskE(taskId, updates),
			"保存任务",
		);
		if (ok) {
			notifySuccess("任务已更新");
			setEditing(false);
			refetch();
		}
	};

	const remove = async () => {
		const task = detail()?.task;
		const confirmed = await showConfirm({
			title: "删除任务",
			message: `确定删除「${task?.title ?? id()}」？子任务也会被一并删除。`,
			variant: "danger",
		});
		if (!confirmed) return;
		const ok = await tryOrNotify(() => deleteTaskE(id()), "删除任务");
		if (ok) navigate(PATHS.task);
	};

	return (
		<div class={styles.container}>
			<Toolbar
				title={detail()?.task.title}
				backLabel="任务列表"
				onBack={() => navigate(PATHS.task)}
			>
				<Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
					编辑
				</Button>
				<Button variant="danger" size="sm" onClick={remove}>
					删除
				</Button>
			</Toolbar>

			<Show when={detail.error}>
				<div class={styles.error}>
					加载失败：{getErrorMessage(detail.error)}
					<Button variant="primary" size="sm" onClick={refetch}>
						重试
					</Button>
				</div>
			</Show>

			<Show when={detail.loading}>
				<div class={styles.loading}>加载中…</div>
			</Show>

			<Show when={detail()}>
				{(d) => (
					<div class={styles.card}>
						<div class={styles.head}>
							<h1 class={styles.title}>{d().task.title}</h1>
							<span class={styles.status}>
								{STATUS_LABEL[d().task.status] ?? d().task.status}
							</span>
						</div>
						<p class={styles.description}>
							{d().task.description || "暂无描述"}
						</p>

						<div class={styles.metaGrid}>
							<div class={styles.metaItem}>
								<span class={styles.metaLabel}>创建时间</span>
								<span>{fmtLocal(d().task.created_at)}</span>
							</div>
							<div class={styles.metaItem}>
								<span class={styles.metaLabel}>更新时间</span>
								<span>{fmtLocal(d().task.updated_at)}</span>
							</div>
							<div class={styles.metaItem}>
								<span class={styles.metaLabel}>预计用时</span>
								<span>
									{d().task.effort_estimate_minutes === null
										? "未设置"
										: `${d().task.effort_estimate_minutes} 分钟`}
								</span>
							</div>
						</div>

						<Show when={d().children.length > 0}>
							<section class={styles.section}>
								<h2 class={styles.sectionTitle}>子任务</h2>
								<div class={styles.chips}>
									<For each={d().children}>
										{(child) => (
											<A
												class={styles.chip}
												href={fillPath(PATHS.taskDetail, child.id)}
											>
												{child.title}
											</A>
										)}
									</For>
								</div>
							</section>
						</Show>

						<Show when={d().depends_on.length > 0}>
							<section class={styles.section}>
								<h2 class={styles.sectionTitle}>依赖任务</h2>
								<div class={styles.chips}>
									<For each={d().depends_on}>
										{(depId) => (
											<A
												class={styles.chip}
												href={fillPath(PATHS.taskDetail, depId)}
											>
												# {depId}
											</A>
										)}
									</For>
								</div>
							</section>
						</Show>

						<Show
							when={d().available_slots.length + d().planned_slots.length > 0}
						>
							<section class={styles.section}>
								<h2 class={styles.sectionTitle}>时间安排</h2>
								<span class={styles.metaText}>
									可行 {d().available_slots.length} 段 · 计划{" "}
									{d().planned_slots.length} 段
								</span>
							</section>
						</Show>
					</div>
				)}
			</Show>

			<EditTaskModal
				isOpen={editing()}
				onClose={() => setEditing(false)}
				task={detail()?.task ?? null}
				allTasks={allTasks() ?? []}
				onSave={save}
				onDependencyChange={() => void refetch()}
			/>
		</div>
	);
}
