import { Input, Select, Tooltip } from "@components/ui";
import {
	AlertTriangle,
	Calendar,
	Clock,
	Pencil,
	Tag,
	Trash2,
} from "@components/ui/icons";
// TagInput 不走 barrel（见 @components/ui 顶部说明：它会把首屏撑大）
import TagInput, {
	type TagOption,
} from "@components/ui/molecules/TagInput.tsx";
import { type Component, createSignal, For, Show } from "solid-js";
import type { Task } from "../api.ts";
import { getTagsE } from "../api.ts";
import { TaskStatus, type TaskStatusType, toTaskStatus } from "../api-types.ts";
import { fromIso, toDateInputValue } from "../lib/dateInput.ts";
import { formatDue } from "../lib/task-group.ts";
import { tagsFromNames } from "../lib/task-payload.ts";
import styles from "./TaskList.module.css";

interface TaskItemProps {
	task: Task;
	onStatusChange: (taskId: number, status: TaskStatusType) => void;
	onDelete: (taskId: number) => void;
	onEdit: () => void;
	children: Task[];
	onAddSubTask?: (parentId: number, title: string) => Promise<void>;
	/** 行内补属性（标签 / 截止时间）用；不给就只有 [+子任务] 那条路径 */
	onUpdate?: (taskId: number, updates: Partial<Task>) => void;
}

const TaskTitle: Component<{ title: string; isSubTask: boolean }> = (props) => (
	<h3 class={styles.taskTitle}>
		{props.title}
		<Show when={props.isSubTask}>
			<span class={styles.subTaskBadge}>子任务</span>
		</Show>
	</h3>
);

/** 截止时间徽章：相对时间 + 逾期标记（**不靠颜色单独承载信息**，WCAG 1.4.1）
 *  图标走 @components/ui/icons（那儿的规矩是不许用 emoji 当图标），
 *  "逾期/明天"这些字本身承担信息，图标只是冗余线索。 */
const DueBadge: Component<{ dueAt: string | null }> = (props) => (
	<Show when={formatDue(props.dueAt)}>
		{(due) => (
			<span
				class={styles.dueBadge}
				classList={{ [styles.dueOverdue]: due().overdue }}
			>
				<Show when={due().overdue} fallback={<Clock size={12} />}>
					<AlertTriangle size={12} />
				</Show>
				{due().text}
			</span>
		)}
	</Show>
);

/** 优先级角标：文字（P1…P4）——形状与文字都携带信息，不是只有颜色 */
const PriorityBadge: Component<{ priority: Task["priority"] }> = (props) => (
	<Show when={props.priority}>
		{(priority) => (
			<span class={styles.priorityBadge}>{priority().toUpperCase()}</span>
		)}
	</Show>
);

function TaskItem(props: TaskItemProps) {
	const [showSubTaskInput, setShowSubTaskInput] = createSignal(false);
	const [subTaskTitle, setSubTaskTitle] = createSignal("");
	// 行内补属性：默认收起，鼠标悬停/聚焦到本行时才显形（避免密集列表里全是图标）
	const [tagEditorOpen, setTagEditorOpen] = createSignal(false);
	const [dateEditorOpen, setDateEditorOpen] = createSignal(false);

	const tagNames = () => props.task.tags.map((tag) => tag.name);

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

	const setTags = (names: string[]) => {
		props.onUpdate?.(props.task.id, { tags: tagsFromNames(names) });
	};

	const setDue = (value: string) => {
		// 原生 datetime-local 给的是本地时间，转成 ISO(UTC) 再发；空串 = 清空
		props.onUpdate?.(props.task.id, {
			due_at: value ? new Date(value).toISOString() : null,
		});
	};

	return (
		<div class={styles.taskItem}>
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
					<TaskTitle
						title={props.task.title}
						isSubTask={!!props.task.parent_task_id}
					/>
					<Show when={props.task.description}>
						<p class={styles.taskDescription}>{props.task.description}</p>
					</Show>
					{/*
					 * 元信息一行、弱化到 --text-xs：按"用户下一步会动什么"排
					 * （截止 → 优先级 → 时长 → 标签）。
					 * 创建时间**不在这里** —— 它不可操作，而且顶着 📅 会被读成"截止"。
					 */}
					<div class={styles.taskMeta}>
						<DueBadge dueAt={props.task.due_at} />
						<PriorityBadge priority={props.task.priority} />
						<Show when={props.task.effort_estimate_minutes}>
							{(minutes) => (
								<span class={styles.effortBadge}>
									<Clock size={12} />
									{minutes()}m
								</span>
							)}
						</Show>
						<For each={props.task.tags}>
							{(tag) => <span class={styles.tagChip}>#{tag.name}</span>}
						</For>
					</div>
					{/* 排序理由（P8）：常驻可见，不藏进 tooltip —— 它是"为什么排这儿"的唯一解释 */}
					<Show when={props.task.reason}>
						{(reason) => <p class={styles.reasonLine}>{reason()}</p>}
					</Show>
				</div>
				<div class={styles.taskActions}>
					{/* 行内补属性（§6）：悬停/聚焦时显形，标签与日期各一个入口 */}
					<Show when={props.onUpdate}>
						<div
							class={styles.inlineActions}
							classList={{
								[styles.inlineActionsOpen]: tagEditorOpen() || dateEditorOpen(),
							}}
						>
							<Tooltip label="标签">
								<button
									type="button"
									class={styles.inlineButton}
									aria-expanded={tagEditorOpen()}
									aria-label={`标签：${props.task.title}`}
									onClick={() => {
										setTagEditorOpen(!tagEditorOpen());
										setDateEditorOpen(false);
									}}
								>
									<Tag size={14} />
								</button>
							</Tooltip>
							<Tooltip label="截止时间">
								<button
									type="button"
									class={styles.inlineButton}
									aria-expanded={dateEditorOpen()}
									aria-label={`截止时间：${props.task.title}`}
									onClick={() => {
										setDateEditorOpen(!dateEditorOpen());
										setTagEditorOpen(false);
									}}
								>
									<Calendar size={14} />
								</button>
							</Tooltip>
						</div>
					</Show>
					<Tooltip label="编辑">
						<button
							type="button"
							onClick={props.onEdit}
							class={styles.editButton}
						>
							<Pencil size={14} />
						</button>
					</Tooltip>
					<Tooltip label="删除">
						<button
							type="button"
							onClick={() => props.onDelete(props.task.id)}
							class={styles.deleteButton}
						>
							<Trash2 size={14} />
						</button>
					</Tooltip>
					<Tooltip label="添加子任务">
						<button
							type="button"
							onClick={() => setShowSubTaskInput(true)}
							class={styles.subTaskButton}
						>
							+
						</button>
					</Tooltip>
				</div>
			</div>
			{/* 行内标签编辑器：整体替换语义（加一个/删一个都发全量标签集） */}
			<Show when={tagEditorOpen()}>
				<div class={styles.inlineEditor}>
					<TagInput
						selected={tagNames()}
						onAdd={(name) => setTags([...tagNames(), name])}
						onRemove={(name) =>
							setTags(tagNames().filter((existing) => existing !== name))
						}
						search={searchTags}
						placeholder="加标签（Enter 确认）"
						ariaLabel={`给「${props.task.title}」加标签`}
					/>
				</div>
			</Show>
			{/* 行内截止时间：原生 datetime-local（设计文档 §6 的口径），空 = 清除 */}
			<Show when={dateEditorOpen()}>
				<div class={styles.inlineEditor}>
					<input
						type="datetime-local"
						class={styles.inlineDateInput}
						value={toDateInputValue(fromIso(props.task.due_at))}
						aria-label={`截止时间：${props.task.title}`}
						onChange={(e) => setDue(e.currentTarget.value)}
					/>
					<button
						type="button"
						class={styles.inlineEditorClear}
						onClick={() => setDue("")}
					>
						清除
					</button>
					<button
						type="button"
						class={styles.inlineEditorClear}
						onClick={() => setDateEditorOpen(false)}
					>
						完成
					</button>
				</div>
			</Show>
			{/* 子任务输入表单 */}
			<Show when={showSubTaskInput()}>
				<div class={styles.subTaskForm}>
					<Input
						type="text"
						placeholder="输入子任务标题，Enter 创建..."
						value={subTaskTitle()}
						onInput={(e) => setSubTaskTitle(e.currentTarget.value)}
						onKeyDown={async (e) => {
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
						autofocus
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
								onEdit={props.onEdit}
								children={[]}
								onAddSubTask={props.onAddSubTask}
							/>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

export default TaskItem;
