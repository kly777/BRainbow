// ── /task/:id：任务详情（全局搜索直达） ──

import { AsyncSection, Button, Toolbar } from "@components/ui";
import { fillPath, PATHS } from "@config/paths";
import {
	deleteTaskE,
	getAllTasksE,
	getTaskDetailE,
	type Task,
	updateTaskE,
} from "@modules/task";
import { getErrorMessage } from "@shared/api";
import {
	confirmAndDelete,
	fmtLocal,
	notifySuccess,
	tryOrNotify,
	useDetailResource,
} from "@shared/utils";
import { A, useNavigate, useParams } from "@solidjs/router";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import EditTaskModal from "./components/EditTaskModal.tsx";
import styles from "./TaskDetail.module.css";

const STATUS_LABEL: Record<string, string> = {
	backlog: "待办",
	active: "进行中",
	completed: "已完成",
	archived: "已归档",
};

type ChipItem = { href: string; label: string | number };

const TaskChip: Component<{ href: string; label: string | number }> = (
	props,
) => (
	<A class={styles.chip} href={props.href}>
		{props.label}
	</A>
);

const ChipSection: Component<{ title: string; chips: ChipItem[] }> = (
	props,
) => (
	<section class={styles.section}>
		<h2 class={styles.sectionTitle}>{props.title}</h2>
		<div class={styles.chips}>
			<For each={props.chips}>
				{(chip) => <TaskChip href={chip.href} label={chip.label} />}
			</For>
		</div>
	</section>
);

const MetaItem: Component<{ label: string; value: string }> = (props) => (
	<div class={styles.metaItem}>
		<span class={styles.metaLabel}>{props.label}</span>
		<span>{props.value}</span>
	</div>
);

const TaskMetaGrid: Component<{
	createdAt: string;
	updatedAt: string;
	effortLabel: string;
}> = (props) => (
	<div class={styles.metaGrid}>
		<MetaItem label="创建时间" value={props.createdAt} />
		<MetaItem label="更新时间" value={props.updatedAt} />
		<MetaItem label="预计用时" value={props.effortLabel} />
	</div>
);

const TimeSection: Component<{ available: number; planned: number }> = (
	props,
) => (
	<section class={styles.section}>
		<h2 class={styles.sectionTitle}>时间安排</h2>
		<span class={styles.metaText}>
			可行 {props.available} 段 · 计划 {props.planned} 段
		</span>
	</section>
);

export default function TaskDetail() {
	const params = useParams();
	const navigate = useNavigate();
	const id = () => Number(params.id);

	// 取数走 useDetailResource（错误消化 / 无效 id / 首次加载 vs 后台刷新的区分都在原语里）
	const m = useDetailResource({
		id,
		validate: (v) => Number.isInteger(v) && v >= 1,
		invalidIdError: new Error("无效的任务 ID"),
		fetcher: (v) => getTaskDetailE(v),
	});
	const detail = m.data;
	const { refetch } = m;
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
		await confirmAndDelete({
			title: "删除任务",
			message: `确定删除「${task?.title ?? id()}」？子任务也会被一并删除。`,
			deleteFn: () => deleteTaskE(id()),
			onSuccess: () => navigate(PATHS.task),
		});
	};

	return (
		<div class={styles.container}>
			<Toolbar backLabel="任务列表" onBack={() => navigate(PATHS.task)}>
				<Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
					编辑
				</Button>
				<Button variant="danger" size="sm" onClick={remove}>
					删除
				</Button>
			</Toolbar>

			<AsyncSection
				data={m.data}
				loading={m.loading}
				error={m.error}
				refreshing={m.refreshing}
				onRetry={refetch}
			>
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

						<TaskMetaGrid
							createdAt={fmtLocal(d().task.created_at)}
							updatedAt={fmtLocal(d().task.updated_at)}
							effortLabel={
								d().task.effort_estimate_minutes === null
									? "未设置"
									: `${d().task.effort_estimate_minutes} 分钟`
							}
						/>

						<Show when={d().children.length > 0}>
							<ChipSection
								title="子任务"
								chips={d().children.map((child) => ({
									href: fillPath(PATHS.taskDetail, child.id),
									label: child.title,
								}))}
							/>
						</Show>

						<Show when={d().depends_on.length > 0}>
							<ChipSection
								title="依赖任务"
								chips={d().depends_on.map((depId) => ({
									href: fillPath(PATHS.taskDetail, depId),
									label: `# ${depId}`,
								}))}
							/>
						</Show>

						<Show
							when={d().available_slots.length + d().planned_slots.length > 0}
						>
							<TimeSection
								available={d().available_slots.length}
								planned={d().planned_slots.length}
							/>
						</Show>
					</div>
				)}
			</AsyncSection>

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
