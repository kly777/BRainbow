// ── 任务行：状态 + 标题是核心，其余都是"按需添加的条件" ──
//
// 这是 09-条件式任务行 的主落点：
// - 标题点击就改（没有铅笔、没有编辑模态）；
// - 行尾一个 `+` 打开条件菜单（计划/截止/优先级/时长/标签），底部是子任务；
// - 已有值以 chip 常驻（TaskMeta），点 chip 改/移除该条件；
// - 没加的条件不占位 —— 一条只想记下来的任务，行里不会出现"待填的表"。
//
// 行内编辑器与录入框共用 ConditionEditor / DateField；条件的取值、校验、
// 载荷映射只有 lib/conditions.ts 那一份。

import { Input, Select, Tooltip } from "@components/ui";
import { Plus, Trash2 } from "@components/ui/icons";
import type { TagOption } from "@components/ui/molecules/TagInput.tsx";
import { isImeComposing, notifyWarning } from "@shared/utils";
import {
	type Component,
	createEffect,
	createSignal,
	For,
	Show,
} from "solid-js";
import type { Task } from "../api.ts";
import { getTagsE } from "../api.ts";
import { TaskStatus, type TaskStatusType, toTaskStatus } from "../api-types.ts";
import {
	type ConditionKey,
	type ConditionValues,
	missingConditions,
	toTaskUpdates,
	validateTimeRange,
	valuesOfTask,
} from "../lib/conditions.ts";
import ConditionEditor from "./ConditionEditor.tsx";
import ConditionMenu from "./ConditionMenu.tsx";
import styles from "./TaskList.module.css";
import { TaskMeta } from "./TaskMeta.tsx";

interface TaskItemProps {
	task: Task;
	onStatusChange: (taskId: number, status: TaskStatusType) => void;
	onDelete: (taskId: number) => void;
	children: Task[];
	onAddSubTask?: (parentId: number, title: string) => Promise<void>;
	/** 行内条件编辑用；不给则整行只读（看板等处） */
	onUpdate?: (taskId: number, updates: Partial<Task>) => void;
}

/** 子任务徽章（属性条本身在 TaskMeta，与看板卡片共用） */
const SubTaskBadge: Component = () => (
	<span class={styles.subTaskBadge}>子任务</span>
);

function TaskItem(props: TaskItemProps) {
	const [showSubTaskInput, setShowSubTaskInput] = createSignal(false);
	const [subTaskTitle, setSubTaskTitle] = createSignal("");
	const [menuOpen, setMenuOpen] = createSignal(false);
	const [editing, setEditing] = createSignal<ConditionKey | null>(null);
	const [editingTitle, setEditingTitle] = createSignal(false);
	const [titleDraft, setTitleDraft] = createSignal("");

	let plusRef: HTMLButtonElement | undefined;
	let titleRef: HTMLInputElement | undefined;
	let subTaskRef: HTMLInputElement | undefined;
	/** 编辑器关闭后焦点回到谁（`+` 或某个 chip） */
	let lastTrigger: HTMLElement | null = null;

	const values = () => valuesOfTask(props.task);

	/** 标签候选：与录入框同一套（去抖 200ms 再问后端） */
	let tagSearchTimer: ReturnType<typeof setTimeout> | undefined;
	const searchTags = (query: string): Promise<TagOption[]> =>
		new Promise((resolve) => {
			clearTimeout(tagSearchTimer);
			tagSearchTimer = setTimeout(async () => {
				try {
					resolve(await getTagsE(query));
				} catch {
					resolve([]);
				}
			}, 200);
		});

	const openCondition = (condition: ConditionKey, trigger?: HTMLElement) => {
		setMenuOpen(false);
		setEditing(condition);
		lastTrigger = trigger ?? plusRef ?? null;
	};

	const closeEditor = () => {
		setEditing(null);
		const target = lastTrigger;
		lastTrigger = null;
		queueMicrotask(() => target?.focus());
	};

	/**
	 * 条件变更的唯一入口：先校验两条时间的关系，再交给 provider 做乐观更新。
	 * 返回人话错误给 ConditionEditor 显示 —— 不把后端的 400 直接丢给用户。
	 */
	const applyCondition = (patch: Partial<ConditionValues>): string | null => {
		const next = { ...values(), ...patch };
		const error = validateTimeRange(next.startAt, next.dueAt);
		if (error) {
			return error;
		}
		props.onUpdate?.(props.task.id, toTaskUpdates(patch));
		return null;
	};

	// ── 标题行内编辑 ──

	const startTitleEdit = () => {
		if (!props.onUpdate) return;
		setTitleDraft(props.task.title);
		setEditingTitle(true);
	};

	createEffect(() => {
		if (editingTitle()) {
			titleRef?.focus();
			titleRef?.select();
		}
	});

	const cancelTitle = () => {
		setEditingTitle(false);
		setTitleDraft(props.task.title);
	};

	const commitTitle = () => {
		if (!editingTitle()) return;
		const title = titleDraft().trim();
		if (!title) {
			notifyWarning("标题不能为空，已还原");
			cancelTitle();
			return;
		}
		if (title !== props.task.title) {
			props.onUpdate?.(props.task.id, { title });
		}
		setEditingTitle(false);
	};

	// ── 子任务 ──

	createEffect(() => {
		if (showSubTaskInput()) {
			subTaskRef?.focus();
		}
	});

	const choose = (key: string) => {
		if (key === "subtask") {
			setMenuOpen(false);
			setShowSubTaskInput(true);
			return;
		}
		openCondition(key as ConditionKey, plusRef);
	};

	return (
		<div
			class={styles.taskItem}
			data-status={props.task.status || TaskStatus.BACKLOG}
		>
			<div class={styles.taskRow}>
				{/*
				 * 状态放在行首（参考产品一致的做法）：它是这一行最主要的动作 ——
				 * Things / Todoist / Linear 都是"点最左边的圆点"完成任务。
				 * 原生 <select> 保留：键盘与读屏行为不做任何改动，只把它画成一个圆点
				 * （见 TaskList.module.css 的 .status-select，形状按状态分四档）。
				 */}
				<div class={styles.taskLead}>
					<Select
						value={props.task.status || TaskStatus.BACKLOG}
						onChange={(e) =>
							props.onStatusChange(
								props.task.id,
								toTaskStatus(e.currentTarget.value),
							)
						}
						class={styles.statusSelect}
						data-status={props.task.status || TaskStatus.BACKLOG}
						aria-label={`任务状态：${props.task.title}`}
					>
						<option value={TaskStatus.BACKLOG}>待办</option>
						<option value={TaskStatus.ACTIVE}>进行中</option>
						<option value={TaskStatus.COMPLETED}>已完成</option>
						<option value={TaskStatus.ARCHIVED}>归档</option>
					</Select>
				</div>

				<div class={styles.taskMain}>
					<h3 class={styles.taskTitle}>
						<Show
							when={editingTitle()}
							fallback={
								<>
									<button
										type="button"
										class={styles.titleButton}
										onClick={startTitleEdit}
										aria-label={`编辑标题：${props.task.title}`}
									>
										{props.task.title}
									</button>
									<Show when={!!props.task.parent_task_id}>
										<SubTaskBadge />
									</Show>
								</>
							}
						>
							<Input
								ref={titleRef}
								class={styles.titleInput}
								value={titleDraft()}
								onInput={(e) => setTitleDraft(e.currentTarget.value)}
								onKeyDown={(e) => {
									if (isImeComposing(e)) return;
									if (e.key === "Enter") {
										e.preventDefault();
										commitTitle();
									}
									if (e.key === "Escape") {
										e.preventDefault();
										cancelTitle();
									}
								}}
								onBlur={commitTitle}
								aria-label="任务标题"
							/>
						</Show>
					</h3>

					<Show when={props.task.description}>
						<p class={styles.taskDescription}>{props.task.description}</p>
					</Show>

					{/*
					 * 属性条：有值才出现（计划 → 截止 → 优先级 → 时长 → 标签）。
					 * onUpdate 给了才可点 —— 只读视图（如看板卡片）不假装能编辑。
					 */}
					<TaskMeta
						task={props.task}
						class={styles.taskMeta}
						onEdit={
							props.onUpdate
								? (condition, trigger) => openCondition(condition, trigger)
								: undefined
						}
					/>

					{/* 排序理由（P8）：常驻可见，不藏进 tooltip —— 它是"为什么排这儿"的唯一解释 */}
					<Show when={props.task.reason}>
						{(reason) => <p class={styles.reasonLine}>{reason()}</p>}
					</Show>
				</div>

				<div
					class={styles.taskActions}
					classList={{
						[styles.actionsOpen]: menuOpen() || editing() !== null,
					}}
				>
					<Show when={props.onUpdate}>
						<Tooltip label="添加条件">
							<button
								ref={plusRef}
								type="button"
								class={styles.addButton}
								aria-expanded={menuOpen()}
								aria-haspopup="menu"
								aria-label={`给「${props.task.title}」添加条件`}
								onClick={() => {
									setEditing(null);
									setMenuOpen(!menuOpen());
								}}
							>
								<Plus size={14} />
							</button>
						</Tooltip>
					</Show>
					<Tooltip label="删除">
						<button
							type="button"
							onClick={() => props.onDelete(props.task.id)}
							class={styles.deleteButton}
							aria-label={`删除任务：${props.task.title}`}
						>
							<Trash2 size={14} />
						</button>
					</Tooltip>
				</div>
			</div>

			<Show when={menuOpen()}>
				<ConditionMenu
					conditions={missingConditions(values())}
					extras={[{ key: "subtask", label: "子任务" }]}
					onSelect={choose}
					onClose={() => {
						setMenuOpen(false);
						queueMicrotask(() => plusRef?.focus());
					}}
					label="添加"
					autoFocus
				/>
			</Show>

			<Show keyed when={editing()}>
				{(condition) => (
					<ConditionEditor
						condition={condition}
						values={values()}
						onChange={applyCondition}
						onClose={closeEditor}
						searchTags={searchTags}
					/>
				)}
			</Show>

			{/* 子任务输入表单 */}
			<Show when={showSubTaskInput()}>
				<div class={styles.subTaskForm}>
					<Input
						ref={subTaskRef}
						type="text"
						placeholder="输入子任务标题，Enter 创建..."
						value={subTaskTitle()}
						onInput={(e) => setSubTaskTitle(e.currentTarget.value)}
						onKeyDown={async (e) => {
							if (isImeComposing(e)) return;
							if (e.key === "Enter" && subTaskTitle().trim()) {
								e.preventDefault();
								const title = subTaskTitle().trim();
								setSubTaskTitle("");
								setShowSubTaskInput(false);
								if (props.onAddSubTask) {
									await props.onAddSubTask(props.task.id, title);
								}
							}
							if (e.key === "Escape") {
								setShowSubTaskInput(false);
								setSubTaskTitle("");
							}
						}}
						class={styles.subTaskInput}
						aria-label="子任务标题"
					/>
					<button
						type="button"
						onClick={() => {
							setShowSubTaskInput(false);
							setSubTaskTitle("");
						}}
						class={styles.subTaskCancel}
					>
						取消
					</button>
				</div>
			</Show>

			{/* 子任务列表 */}
			<Show when={props.children.length > 0}>
				<div class={styles.childList}>
					<For each={props.children}>
						{(child) => (
							<TaskItem
								task={child}
								onStatusChange={props.onStatusChange}
								onDelete={props.onDelete}
								children={[]}
								onAddSubTask={props.onAddSubTask}
								onUpdate={props.onUpdate}
							/>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

export default TaskItem;
