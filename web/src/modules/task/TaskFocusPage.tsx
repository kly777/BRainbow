// ── /task/:id：任务聚焦页 ──
//
// 列表只负责"看见"，这里负责"说全"：标题、描述、状态、时间、优先级、标签、
// 子任务与时间块都在这一页完成。原来的详情页是只读摘要 + 删除，这一版是真正的
// 任务编辑器，同时保留从列表/搜索直达的路径。

import {
	AsyncSection,
	Button,
	Input,
	Select,
	Textarea,
	showConfirm,
} from "@components/ui";
import TagInput from "@components/ui/molecules/TagInput.tsx";
import {
	ArrowLeft,
	Calendar,
	CheckCircle2,
	Clock,
	Plus,
	Trash2,
	X,
} from "@components/ui/icons";
import { fillPath, PATHS } from "@config/paths";
import { notifyError, notifySuccess } from "@shared/errors";
import { fmtLocal, isImeComposing, useDetailResource } from "@shared/utils";
import type { TagOption } from "@components/ui/molecules/TagInput.tsx";
import { A, useNavigate, useParams } from "@solidjs/router";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { Tag, TaskBlock } from "./api.ts";
import {
	createTaskE,
	deleteTaskE,
	getTagsE,
	getTaskDetailE,
	updateTaskE,
} from "./api.ts";
import type { TaskPriority, TaskStatusType } from "./api-types.ts";
import DateField from "./components/DateField.tsx";
import RecurrenceForm from "./components/RecurrenceForm.tsx";
import { TaskMeta } from "./components/TaskMeta.tsx";
import styles from "./TaskFocusPage.module.css";

const STATUS_LABEL: Record<TaskStatusType, string> = {
	backlog: "待办",
	active: "进行中",
	completed: "已完成",
	archived: "已归档",
};

const PRIORITIES: readonly { value: TaskPriority | ""; label: string }[] = [
	{ value: "", label: "未设置" },
	{ value: "p1", label: "P1 · 最急" },
	{ value: "p2", label: "P2 · 急" },
	{ value: "p3", label: "P3 · 普通" },
	{ value: "p4", label: "P4 · 有空" },
];

const toDate = (value: string | null): Date | null => {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};

const formatBlock = (block: TaskBlock) => {
	const start = new Date(block.start_at).toLocaleString("zh-CN", {
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
	if (!block.end_at) return `${start} 起`;
	const end = new Date(block.end_at).toLocaleString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
	});
	return `${start} – ${end}`;
};

export default function TaskFocusPage() {
	const params = useParams();
	const navigate = useNavigate();
	const id = () => Number(params.id);

	const m = useDetailResource({
		id,
		validate: (value) => Number.isInteger(value) && value >= 1,
		invalidIdError: new Error("无效的任务 ID"),
		fetcher: (value) => getTaskDetailE(value),
	});
	const detail = m.data;
	const { refetch } = m;

	const [titleDraft, setTitleDraft] = createSignal("");
	const [descDraft, setDescDraft] = createSignal("");
	const [childTitle, setChildTitle] = createSignal("");
	const [childOpen, setChildOpen] = createSignal(false);
	const [saving, setSaving] = createSignal(false);
	const [recurring, setRecurring] = createSignal(false);

	createEffect(() => {
		const task = detail()?.task;
		if (!task) return;
		setTitleDraft(task.title);
		setDescDraft(task.description ?? "");
	});

	const patch = async (updates: Parameters<typeof updateTaskE>[1]) => {
		setSaving(true);
		try {
			await updateTaskE(id(), updates);
			refetch();
			notifySuccess("已保存", detail()?.task.title);
			return true;
		} catch (error) {
			notifyError("保存失败", error);
			return false;
		} finally {
			setSaving(false);
		}
	};

	const saveTitle = async () => {
		if (saving()) return;
		const task = detail()?.task;
		if (!task) return;
		const title = titleDraft().trim();
		if (!title) {
			setTitleDraft(task.title);
			notifyError("标题不能为空");
			return;
		}
		if (title !== task.title) await patch({ title });
	};

	const saveDescription = async () => {
		if (saving()) return;
		const task = detail()?.task;
		if (!task) return;
		const description = descDraft().trim();
		if (description !== (task.description ?? "")) {
			await patch({ description: description || null });
		}
	};

	const saveTags = (tags: Tag[]) => {
		void patch({ tags: tags.map((tag) => tag.name) });
	};

	const addTag = (name: string) => {
		const task = detail()?.task;
		if (!task || task.tags.some((tag) => tag.name === name)) return;
		saveTags([...task.tags, { id: -1, name }]);
	};

	const removeTag = (name: string) => {
		const task = detail()?.task;
		if (!task) return;
		saveTags(task.tags.filter((tag) => tag.name !== name));
	};

	let tagTimer: ReturnType<typeof setTimeout> | undefined;
	const searchTags = (query: string): Promise<TagOption[]> =>
		new Promise((resolve) => {
			clearTimeout(tagTimer);
			tagTimer = setTimeout(async () => {
				try {
					resolve(await getTagsE(query));
				} catch {
					resolve([]);
				}
			}, 200);
		});

	const addChild = async () => {
		const title = childTitle().trim();
		if (!title) return;
		try {
			await createTaskE({ title, parent_task_id: id() });
			setChildTitle("");
			setChildOpen(false);
			refetch();
		} catch (error) {
			notifyError("创建子任务失败", error);
		}
	};

	const remove = async () => {
		const task = detail()?.task;
		if (!task) return;
		const confirmed = await showConfirm({
			title: "删除任务",
			message: `确定删除「${task.title}」？子任务也会一并删除。`,
			variant: "danger",
			confirmLabel: "删除",
		});
		if (!confirmed) return;
		try {
			await deleteTaskE(id());
			notifySuccess("任务已删除");
			navigate(PATHS.task);
		} catch (error) {
			notifyError("删除失败", error);
		}
	};

	return (
		<div class={styles.page}>
			<header class={styles.topbar}>
				<A class={styles.back} href={PATHS.task}>
					<ArrowLeft size={15} />
					任务
				</A>
				<span class={styles.crumb}>/ #{id()}</span>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => setRecurring(true)}
					title="把这条任务设为循环"
				>
					设为重复
				</Button>
				<Button variant="danger" size="sm" onClick={remove} title="删除任务">
					<Trash2 size={14} />
					删除
				</Button>
			</header>

			<AsyncSection
				data={m.data}
				loading={m.loading}
				error={m.error}
				refreshing={m.refreshing}
				onRetry={refetch}
			>
				{(d) => (
					<div class={styles.layout}>
						<main class={styles.main}>
							<div class={styles.hero}>
								<p class={styles.eyebrow}>
									{STATUS_LABEL[d().task.status] ?? d().task.status}
									{d().task.parent_task_id ? " · 子任务" : ""}
								</p>
								<Input
									class={styles.titleInput}
									value={titleDraft()}
									onInput={(e) => setTitleDraft(e.currentTarget.value)}
									onBlur={saveTitle}
									onKeyDown={(e) => {
										if (isImeComposing(e)) return;
										if (e.key === "Enter") {
											e.preventDefault();
											void saveTitle();
										}
										if (e.key === "Escape") {
											setTitleDraft(d().task.title);
											e.currentTarget.blur();
										}
									}}
									aria-label="任务标题"
								/>
								<Textarea
									class={styles.descInput}
									value={descDraft()}
									placeholder="补一句背景、验收标准，或者为什么现在做它…"
									onInput={(e) => setDescDraft(e.currentTarget.value)}
									onBlur={saveDescription}
									aria-label="任务描述"
								/>
								<TaskMeta task={d().task} class={styles.meta} />
							</div>

							<section class={styles.section}>
								<header class={styles.sectionHead}>
									<h2 class={styles.sectionTitle}>时间</h2>
									<span class={styles.sectionHint}>
										计划 {d().planned_blocks.length} 段 · 可行{" "}
										{d().feasible_blocks.length} 段
									</span>
								</header>
								<Show
									when={
										d().planned_blocks.length + d().feasible_blocks.length > 0
									}
									fallback={
										<p class={styles.emptyLine}>
											还没排时间。去日历里把这条任务拖进一个时段，或者先标一段可行时间。
										</p>
									}
								>
									<div class={styles.blocks}>
										<For each={d().planned_blocks}>
											{(block) => (
												<div class={styles.block}>
													<span class={styles.blockKind}>计划</span>
													<span>{formatBlock(block)}</span>
												</div>
											)}
										</For>
										<For each={d().feasible_blocks}>
											{(block) => (
												<div class={`${styles.block} ${styles.feasible}`}>
													<span class={styles.blockKind}>可行</span>
													<span>{formatBlock(block)}</span>
												</div>
											)}
										</For>
									</div>
								</Show>
							</section>

							<section class={styles.section}>
								<header class={styles.sectionHead}>
									<h2 class={styles.sectionTitle}>子任务</h2>
									<button
										type="button"
										class={styles.addChildButton}
										onClick={() => setChildOpen(!childOpen())}
									>
										<Plus size={14} />
										添加
									</button>
								</header>
								<Show when={childOpen()}>
									<div class={styles.childComposer}>
										<Input
											value={childTitle()}
											placeholder="子任务标题，回车创建"
											onInput={(e) => setChildTitle(e.currentTarget.value)}
											onKeyDown={(e) => {
												if (isImeComposing(e)) return;
												if (e.key === "Enter") {
													e.preventDefault();
													void addChild();
												}
												if (e.key === "Escape") setChildOpen(false);
											}}
											aria-label="子任务标题"
										/>
										<button
											type="button"
											class={styles.iconButton}
											onClick={() => setChildOpen(false)}
											aria-label="取消添加子任务"
										>
											<X size={14} />
										</button>
									</div>
								</Show>
								<Show
									when={d().children.length > 0}
									fallback={<p class={styles.emptyLine}>还没有子任务。</p>}
								>
									<ul class={styles.children}>
										<For each={d().children}>
											{(child) => (
												<li>
													<A
														class={styles.childLink}
														href={fillPath(PATHS.taskDetail, child.id)}
													>
														<CheckCircle2 size={15} />
														<span>{child.title}</span>
														<span class={styles.childStatus}>
															{STATUS_LABEL[child.status] ?? child.status}
														</span>
													</A>
												</li>
											)}
										</For>
									</ul>
								</Show>
							</section>

							<Show when={d().depends_on.length > 0}>
								<section class={styles.section}>
									<header class={styles.sectionHead}>
										<h2 class={styles.sectionTitle}>前置依赖</h2>
									</header>
									<div class={styles.depends}>
										<For each={d().depends_on}>
											{(depId) => (
												<A
													class={styles.depLink}
													href={fillPath(PATHS.taskDetail, depId)}
												>
													#{depId}
												</A>
											)}
										</For>
									</div>
								</section>
							</Show>
						</main>

						<aside class={styles.side}>
							<section class={styles.sideCard}>
								<h2 class={styles.sideTitle}>属性</h2>
								<div class={styles.field}>
									<label class={styles.label} for="focus-status">
										状态
									</label>
									<Select
										id="focus-status"
										value={d().task.status}
										onChange={(e) =>
											void patch({
												status: e.currentTarget.value as TaskStatusType,
											})
										}
									>
										<option value="backlog">待办</option>
										<option value="active">进行中</option>
										<option value="completed">已完成</option>
										<option value="archived">已归档</option>
									</Select>
								</div>

								<div class={styles.field}>
									<label class={styles.label} for="focus-priority">
										优先级
									</label>
									<Select
										id="focus-priority"
										value={d().task.priority ?? ""}
										onChange={(e) =>
											void patch({
												priority: (e.currentTarget.value ||
													null) as TaskPriority | null,
											})
										}
									>
										<For each={PRIORITIES}>
											{(item) => (
												<option value={item.value}>{item.label}</option>
											)}
										</For>
									</Select>
								</div>

								<div class={styles.field}>
									<label class={styles.label} for="focus-start">
										<Calendar size={13} /> 计划开始
									</label>
									<DateField
										id="focus-start"
										label="计划开始"
										hideLabel
										value={toDate(d().task.start_at)}
										onChange={(value: Date | null) =>
											void patch({ start_at: value?.toISOString() ?? null })
										}
									/>
								</div>

								<div class={styles.field}>
									<label class={styles.label} for="focus-due">
										<Clock size={13} /> 截止
									</label>
									<DateField
										id="focus-due"
										label="截止"
										hideLabel
										value={toDate(d().task.due_at)}
										onChange={(value: Date | null) =>
											void patch({ due_at: value?.toISOString() ?? null })
										}
									/>
								</div>

								<div class={styles.field}>
									<label class={styles.label} for="focus-effort">
										预计时长（分钟）
									</label>
									<Input
										id="focus-effort"
										type="number"
										min="0"
										step="5"
										value={d().task.effort_estimate_minutes ?? ""}
										onBlur={(e) => {
											const raw = e.currentTarget.value.trim();
											const minutes = raw === "" ? null : Number(raw);
											if (
												minutes !== null &&
												(!Number.isFinite(minutes) || minutes < 0)
											) {
												notifyError("预计时长必须是非负数字");
												return;
											}
											if (minutes !== d().task.effort_estimate_minutes) {
												void patch({ effort_estimate_minutes: minutes });
											}
										}}
									/>
								</div>

								<div class={styles.field}>
									<span class={styles.label}>标签</span>
									<TagInput
										selected={d().task.tags.map((tag) => tag.name)}
										onAdd={addTag}
										onRemove={removeTag}
										search={searchTags}
										placeholder="加标签，回车确认"
										ariaLabel="任务标签"
									/>
								</div>

								<Show when={saving()}>
									<p class={styles.saving}>保存中…</p>
								</Show>
							</section>

							<section class={styles.sideCard}>
								<h2 class={styles.sideTitle}>记录</h2>
								<dl class={styles.metaList}>
									<div>
										<dt>创建</dt>
										<dd>{fmtLocal(d().task.created_at)}</dd>
									</div>
									<div>
										<dt>更新</dt>
										<dd>{fmtLocal(d().task.updated_at)}</dd>
									</div>
									<div>
										<dt>完成</dt>
										<dd>
											{d().task.completed_at
												? fmtLocal(d().task.completed_at as string)
												: "—"}
										</dd>
									</div>
								</dl>
							</section>

							<A class={styles.backList} href={PATHS.task}>
								返回任务列表
							</A>
						</aside>
					</div>
				)}
			</AsyncSection>

			<Show when={recurring() && detail()}>
				<RecurrenceForm
					task={detail()!.task}
					isOpen={recurring()}
					onClose={() => setRecurring(false)}
					onSaved={() => {
						setRecurring(false);
						refetch();
					}}
				/>
			</Show>
		</div>
	);
}
