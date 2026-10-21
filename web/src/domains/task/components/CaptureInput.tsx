// ── 录入框：一句话 + 按需加条件 ──
//
// 与任务行同一套心智（09-条件式任务行）：
// - 第 1 层永远只有单行 + 回车即建；`!p1` / `#标签` / `~60m` 继续解析。
// - 行尾 `+` 打开条件菜单（计划/截止/优先级/时长/标签/父任务）。
// - 已加的条件以 chip 排在输入框下方；点 chip 改/移除；没加的不占位。
// - 日期没有符号，只能从 `+` 加；优先级/标签/时长与标题里的 token 是同一份状态。
//
// 提交后焦点回到标题框（连续录入的命门），失败时原文与条件一并还原 ——
// 这两条在上一轮已经用测试钉住，重构时不许丢。

import { Button, Input, Select } from "@components/ui";
import type { TagOption } from "@components/ui/molecules/TagInput.tsx";
import { isImeComposing, notifyWarning } from "@shared/utils";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import type { Task, TaskPriority } from "../api.ts";
import { getTagsE } from "../api.ts";
import {
	mentionsToDescription,
	parseCapture,
	setEffortToken,
	setPriorityToken,
	setTagTokens,
} from "../model/capture.ts";
import {
	type ConditionKey,
	type ConditionValues,
	formatEffort,
	formatPlan,
	missingConditions,
	validateTimeRange,
} from "../model/conditions.ts";
import { formatDue } from "../model/due.ts";
import styles from "./CaptureInput.module.css";
import ConditionEditor from "./ConditionEditor.tsx";
import ConditionMenu from "./ConditionMenu.tsx";

/** 提交载荷：标题与四类属性（含本期不落库的提及）都在这里 */
export interface CaptureSubmit {
	/** 归一化后的标题（空标题不会走到提交） */
	title: string;
	/** 提及那一行（`> 提及：@bob`）；没有提及则为 null */
	description: string | null;
	priority: TaskPriority | null;
	tags: string[];
	effortMinutes: number | null;
	/** ISO 串（UTC）；空为 null */
	startAt: string | null;
	dueAt: string | null;
	parentTaskId: number | null;
}

export interface CaptureInputProps {
	/**
	 * 提交。返回 `true` 表示已创建，`false` 表示失败。
	 *
	 * **返回值是有意义的**：失败时本组件**不清空输入框**、把焦点留在原地，
	 * 用户写的内容还在、可以直接改。原先这里是 `void` 且先清空再 await ——
	 * 创建失败（例如标题超 255 被后端 400 拒）时内容已经被丢掉，用户既看不到
	 * 原因也找不回原文，等同静默丢数据。
	 *
	 * 失败的原因由调用方提示（provider 的 `add` 已经调 `notifyError`）。
	 */
	onSubmit: (
		payload: CaptureSubmit,
	) => boolean | undefined | Promise<boolean | undefined>;
	/** 父任务候选；缺省（或不给）时不显示"父任务"这一项 */
	parentCandidates?: readonly Task[];
	placeholder?: string;
	class?: string;
}

/** 标签补全的输入去抖（设计文档 S2-8：200ms） */
const TAG_SEARCH_DEBOUNCE_MS = 200;

/** 已加条件的 chip：点它回到对应编辑器 */
const ConditionChip: Component<{
	label: string;
	ariaLabel: string;
	onClick: () => void;
	class?: string;
}> = (props) => (
	<button
		type="button"
		class={`${styles.chip}${props.class ? ` ${props.class}` : ""}`}
		onClick={props.onClick}
		aria-label={props.ariaLabel}
	>
		{props.label}
	</button>
);

export default function CaptureInput(props: CaptureInputProps) {
	let inputRef: HTMLInputElement | undefined;
	let plusRef: HTMLButtonElement | undefined;

	const [text, setText] = createSignal("");
	const [menuOpen, setMenuOpen] = createSignal(false);
	const [editing, setEditing] = createSignal<ConditionKey | "parent" | null>(
		null,
	);
	// 日期与父任务没有符号可回写，是面板自己的状态
	const [startAt, setStartAt] = createSignal<Date | null>(null);
	const [dueAt, setDueAt] = createSignal<Date | null>(null);
	const [parentId, setParentId] = createSignal<number | null>(null);

	const parsed = createMemo(() => parseCapture(text()));

	/** 条件值：优先级/标签/时长来自标题里的 token，日期/父任务来自本地状态 */
	const values = createMemo<ConditionValues>(() => ({
		startAt: startAt()?.toISOString() ?? null,
		dueAt: dueAt()?.toISOString() ?? null,
		priority: parsed().priority,
		effortMinutes: parsed().effortMinutes,
		tags: parsed().tags,
	}));

	/** 纯符号 / 纯空格：标题为空，不能提交（A1） */
	const titleMissing = () => parsed().cleanTitle.length === 0;
	const timeError = () => validateTimeRange(values().startAt, values().dueAt);

	const parentTitle = () =>
		props.parentCandidates?.find((task) => task.id === parentId())?.title ??
		`#${parentId()}`;

	const anyValue = () =>
		values().startAt !== null ||
		values().dueAt !== null ||
		values().priority !== null ||
		values().effortMinutes !== null ||
		values().tags.length > 0 ||
		parentId() !== null;

	/**
	 * 条件变更：与任务行同一个契约 —— 先校验时间关系，再写回唯一真相
	 * （优先级/标签/时长写文本 token；日期/父任务写本地状态）。
	 */
	const applyCondition = (patch: Partial<ConditionValues>): string | null => {
		const next = { ...values(), ...patch };
		const error = validateTimeRange(next.startAt, next.dueAt);
		if (error) {
			return error;
		}
		if (patch.startAt !== undefined) {
			setStartAt(patch.startAt ? new Date(patch.startAt) : null);
		}
		if (patch.dueAt !== undefined) {
			setDueAt(patch.dueAt ? new Date(patch.dueAt) : null);
		}
		if (patch.priority !== undefined) {
			setText(setPriorityToken(text(), patch.priority));
		}
		if (patch.effortMinutes !== undefined) {
			setText(setEffortToken(text(), patch.effortMinutes));
		}
		if (patch.tags !== undefined) {
			setText(setTagTokens(text(), patch.tags));
		}
		return null;
	};

	const reset = () => {
		setText("");
		setStartAt(null);
		setDueAt(null);
		setParentId(null);
		setMenuOpen(false);
		setEditing(null);
	};

	/** 提交后清空并**把焦点还给标题框**（A3：连续录入的命门） */
	const submit = async (keepText: boolean) => {
		if (titleMissing()) {
			return;
		}
		const invalidRange = timeError();
		if (invalidRange) {
			notifyWarning(invalidRange);
			return;
		}
		const result = parsed();
		const payload: CaptureSubmit = {
			title: result.cleanTitle,
			description: mentionsToDescription(result.mentions),
			priority: result.priority,
			tags: result.tags,
			effortMinutes: result.effortMinutes,
			startAt: startAt()?.toISOString() ?? null,
			dueAt: dueAt()?.toISOString() ?? null,
			parentTaskId: parentId(),
		};

		// 失败时要还原的东西：**提交前**先留着（不能等失败了才想起来）
		const restore = {
			text: text(),
			startAt: startAt(),
			dueAt: dueAt(),
			parentId: parentId(),
		};

		// 先乐观清空、**立刻**清：回车即清是连着录入的手感（P2），
		// 放在 await 之后会让输入框在网络往返期间还留着原文，连按两下就建出两条。
		if (keepText) {
			// 连写多条：只清条件，标题留着改改再发
			setStartAt(null);
			setDueAt(null);
			setParentId(null);
			setEditing(null);
			setMenuOpen(false);
		} else {
			reset();
		}

		const outcome = await props.onSubmit(payload);

		if (outcome === false) {
			// 失败（标题超 255 之类）：把原文放回去，原因已由 provider 弹过 toast。
			// 不还原就是静默丢数据 —— 用户写的东西既看不见也找不回。
			setText(restore.text);
			setStartAt(restore.startAt);
			setDueAt(restore.dueAt);
			setParentId(restore.parentId);
		}
		inputRef?.focus();
	};

	const openMenu = () => {
		setEditing(null);
		setMenuOpen(true);
	};

	const closeMenu = () => {
		setMenuOpen(false);
		queueMicrotask(() => plusRef?.focus());
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (isImeComposing(e)) {
			return; // 组字期间的回车是选词，不是提交
		}
		if (e.key === "Enter") {
			e.preventDefault();
			void submit(e.shiftKey);
			return;
		}
		if (e.key === "ArrowDown" && !menuOpen() && editing() === null) {
			e.preventDefault();
			openMenu();
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			if (menuOpen()) {
				setMenuOpen(false);
			} else if (editing() !== null) {
				setEditing(null);
			} else {
				setText("");
			}
		}
	};

	// 标签候选：去抖 200ms 再问后端（打一个字符不请求一次）
	let tagSearchTimer: ReturnType<typeof setTimeout> | undefined;
	const searchTags = (query: string): Promise<TagOption[]> =>
		new Promise((resolve) => {
			clearTimeout(tagSearchTimer);
			tagSearchTimer = setTimeout(async () => {
				try {
					resolve(await getTagsE(query));
				} catch {
					resolve([]); // 补全失败不该挡住录入
				}
			}, TAG_SEARCH_DEBOUNCE_MS);
		});

	const conditionEditing = () => {
		const value = editing();
		return value === "parent" ? null : value;
	};

	return (
		<div class={`${styles.capture}${props.class ? ` ${props.class}` : ""}`}>
			<div class={styles.row}>
				<Input
					ref={inputRef}
					class={styles.titleInput}
					value={text()}
					placeholder={props.placeholder ?? "写周报 !p1 #工作 ~60m"}
					aria-label="任务标题（!p1 优先级、#标签、@提及、~60m 时长）"
					onInput={(e) => setText(e.currentTarget.value)}
					onKeyDown={onKeyDown}
				/>
				<Button
					ref={plusRef}
					variant="ghost"
					size="sm"
					class={styles.expandButton}
					tabindex={-1}
					aria-expanded={menuOpen()}
					aria-haspopup="menu"
					aria-controls="capture-conditions"
					aria-label={menuOpen() ? "收起添加菜单" : "添加条件"}
					title={menuOpen() ? "收起添加菜单（↓）" : "添加条件（↓）"}
					onClick={() => (menuOpen() ? closeMenu() : openMenu())}
				>
					{menuOpen() ? "−" : "+"}
				</Button>
			</div>

			{/* 已加的条件：有值才出现，点 chip 回到对应编辑器 */}
			<Show when={anyValue()}>
				<div class={styles.chips}>
					<Show when={formatPlan(values().startAt, values().effortMinutes)}>
						{(label) => (
							<ConditionChip
								label={label()}
								ariaLabel="编辑计划时间"
								onClick={() => setEditing("start")}
							/>
						)}
					</Show>
					<Show when={formatDue(values().dueAt)}>
						{(due) => (
							<ConditionChip
								label={due().text}
								ariaLabel="编辑截止时间"
								onClick={() => setEditing("due")}
							/>
						)}
					</Show>
					<Show when={values().priority}>
						{(priority) => (
							<ConditionChip
								label={priority().toUpperCase()}
								ariaLabel="编辑优先级"
								onClick={() => setEditing("priority")}
							/>
						)}
					</Show>
					<Show when={values().effortMinutes}>
						{(minutes) => (
							<ConditionChip
								label={`⏱${formatEffort(minutes())}`}
								ariaLabel="编辑预计时长"
								onClick={() => setEditing("effort")}
							/>
						)}
					</Show>
					<For each={values().tags}>
						{(tag) => (
							<ConditionChip
								label={`#${tag}`}
								ariaLabel={`编辑标签「${tag}」`}
								onClick={() => setEditing("tags")}
							/>
						)}
					</For>
					<Show when={parentId() !== null}>
						<ConditionChip
							label={`父：${parentTitle()}`}
							ariaLabel="编辑父任务"
							onClick={() => setEditing("parent")}
						/>
					</Show>
				</div>
			</Show>

			{/* 实时预览：只留"系统没听懂 / 不能提交"的提醒；已识别的值在 chips 里 */}
			<Show
				when={
					titleMissing() ||
					timeError() !== null ||
					parsed().unparsed.length > 0 ||
					parsed().mentions.length > 0
				}
			>
				<div class={styles.preview} aria-live="polite">
					<Show when={titleMissing() && text().trim().length > 0}>
						<span class={styles.previewWarning}>
							只有符号没有标题，写点内容才能建
						</span>
					</Show>
					<Show when={timeError()}>
						{(message) => (
							<span class={styles.previewWarning}>{message()}</span>
						)}
					</Show>
					<Show when={parsed().mentions.length > 0}>
						<span class={styles.chipMuted}>
							提及 @{parsed().mentions.join(" @")}
						</span>
					</Show>
					<Show when={parsed().unparsed.length > 0}>
						{/* 未识别的 token 会留在标题里 —— 说清楚，别让用户以为生效了 */}
						<span class={styles.previewWarning}>
							没认出来（会留在标题里）：{parsed().unparsed.join(" ")}
						</span>
					</Show>
				</div>
			</Show>

			<Show when={menuOpen()}>
				<div id="capture-conditions">
					<ConditionMenu
						conditions={missingConditions(values())}
						extras={
							(props.parentCandidates?.length ?? 0) > 0 && parentId() === null
								? [{ key: "parent", label: "父任务" }]
								: []
						}
						onSelect={(key) => {
							setMenuOpen(false);
							setEditing(key === "parent" ? "parent" : (key as ConditionKey));
						}}
						onClose={closeMenu}
						label="添加"
					/>
				</div>
			</Show>

			<Show keyed when={conditionEditing()}>
				{(condition) => (
					<ConditionEditor
						condition={condition}
						values={values()}
						onChange={applyCondition}
						onClose={() => {
							setEditing(null);
							queueMicrotask(() => inputRef?.focus());
						}}
						searchTags={searchTags}
					/>
				)}
			</Show>

			<Show when={editing() === "parent"}>
				<fieldset class={styles.editor} aria-label="编辑父任务">
					<div class={styles.editorHeader}>
						<span class={styles.editorTitle}>父任务</span>
						<button
							type="button"
							class={styles.editorDone}
							onClick={() => {
								setEditing(null);
								queueMicrotask(() => inputRef?.focus());
							}}
							aria-label="收起父任务编辑"
						>
							完成
						</button>
					</div>
					<Select
						value={parentId() ?? ""}
						onChange={(e) =>
							setParentId(
								e.currentTarget.value === ""
									? null
									: Number(e.currentTarget.value),
							)
						}
						aria-label="父任务"
					>
						<option value="">（无）</option>
						<For each={props.parentCandidates}>
							{(candidate) => (
								<option value={candidate.id}>{candidate.title}</option>
							)}
						</For>
					</Select>
				</fieldset>
			</Show>
		</div>
	);
}
