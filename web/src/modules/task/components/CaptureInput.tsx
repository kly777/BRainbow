// ── 录入框：两层结构（P1/P3）──
//
// 第 1 层：常驻单行 + 实时解析预览。写 `写周报 !p1 #工作 ~60m` 回车就建，
// 焦点留在框里（连续录入 5 条 = 5 次「输入 + 回车」，中间零鼠标）。
// 第 2 层：`[+]`（或 ↓ / Alt+↓）唤出的六个控件，全部可选 —— 展开时焦点**仍在标题框**。
//
// 两层是同一份状态的两种输入方式：标题行里的 `!p1` 与下拉里的 p1 是同一个值，
// 改任一侧另一侧跟着变（回写走 lib/capture.ts 的 token 替换，纯文本、无中间态）。
// 日期**没有符号**，所以它只在第 2 层存在。
//
// 无障碍：
// - 标题框有 aria-label；`[+]` 有 aria-expanded 与 aria-controls，且 tabindex=-1
//   （键盘用 ↓ 唤出，不必为它多按一次 Tab）
// - 展开后第 2 层的控件是真控件、Tab 能到（**刻意不锁 Tab**：把焦点锁在输入框里
//   会构成键盘陷阱，WCAG 2.1.2）
// - 输入法组字期间回车/方向键不抢（与命令面板同一道闸门）

import { Button, Input, Select } from "@components/ui";
// TagInput 刻意不在 @components/ui 的 barrel 里导出（见那份说明：会把首屏撑大），
// 所以按路径取
import TagInput, {
	type TagOption,
} from "@components/ui/molecules/TagInput.tsx";
import { isImeComposing } from "@shared/utils";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Task, TaskPriority } from "../api.ts";
import { getTagsE } from "../api.ts";
import {
	addTagToken,
	mentionsToDescription,
	parseCapture,
	removeTagToken,
	setEffortToken,
	setPriorityToken,
} from "../lib/capture.ts";
import {
	DATE_HELPER,
	formatDateInput,
	parseDateInput,
} from "../lib/dateInput.ts";
import styles from "./CaptureInput.module.css";

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
	/** 提交（调用方负责乐观更新与 toast；本组件只管清空与焦点） */
	onSubmit: (payload: CaptureSubmit) => void | Promise<void>;
	/** 父任务候选；缺省（或不给）时不显示"父任务"控件 */
	parentCandidates?: readonly Task[];
	placeholder?: string;
	class?: string;
}

/** 标签补全的输入去抖（设计文档 S2-8：200ms） */
const TAG_SEARCH_DEBOUNCE_MS = 200;

export default function CaptureInput(props: CaptureInputProps) {
	let inputRef: HTMLInputElement | undefined;
	const [text, setText] = createSignal("");
	const [expanded, setExpanded] = createSignal(false);
	// 日期与父任务没有符号可回写，是第 2 层自己的状态
	const [startAt, setStartAt] = createSignal<Date | null>(null);
	const [dueAt, setDueAt] = createSignal<Date | null>(null);
	const [parentId, setParentId] = createSignal<number | null>(null);
	const [effortDraft, setEffortDraft] = createSignal("");

	const parsed = createMemo(() => parseCapture(text()));
	/** 纯符号 / 纯空格：标题为空，不能提交（A1） */
	const titleMissing = () => parsed().cleanTitle.length === 0;

	const canSubmit = () => !titleMissing();

	const effortFieldId = "capture-effort";

	// 文本侧的时长变化要反映到输入框（除非用户正在那个框里打字）
	createEffect(() => {
		const minutes = parsed().effortMinutes;
		if (document.activeElement?.id !== effortFieldId) {
			setEffortDraft(minutes === null ? "" : String(minutes));
		}
	});

	const reset = () => {
		setText("");
		setStartAt(null);
		setDueAt(null);
		setParentId(null);
		setExpanded(false);
		setEffortDraft("");
	};

	/** 提交后清空并**把焦点还给标题框**（A3：连续录入的命门） */
	const submit = async (keepText: boolean) => {
		if (!canSubmit()) {
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
		if (keepText) {
			// 连写多条：只清第 2 层的日期/父任务，标题留着改改再发
			setStartAt(null);
			setDueAt(null);
			setParentId(null);
		} else {
			reset();
		}
		await props.onSubmit(payload);
		inputRef?.focus();
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
		if (e.key === "ArrowDown" && !expanded()) {
			e.preventDefault();
			setExpanded(true);
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			if (expanded()) {
				setExpanded(false);
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

	return (
		<div class={`${styles.capture}${props.class ? ` ${props.class}` : ""}`}>
			<div class={styles.row}>
				<Input
					ref={inputRef}
					class={styles.titleInput}
					value={text()}
					placeholder={props.placeholder ?? "写周报 !p1 #工作 ~60m"}
					aria-label="任务标题（可用 ! 优先级 # 标签 @ 提及 ~ 时长）"
					onInput={(e) => setText(e.currentTarget.value)}
					onKeyDown={onKeyDown}
				/>
				<Button
					variant="ghost"
					size="sm"
					class={styles.expandButton}
					tabindex={-1}
					aria-expanded={expanded()}
					aria-controls="capture-panel"
					aria-label={expanded() ? "收起更多选项" : "更多选项"}
					title={expanded() ? "收起更多选项（↓）" : "更多选项（↓）"}
					onClick={() => setExpanded(!expanded())}
				>
					{expanded() ? "−" : "+"}
				</Button>
			</div>

			{/* 实时预览：把"系统听懂了多少"摆在明面上（P8：不允许无法解释的结果） */}
			<Show when={text().trim().length > 0}>
				<div class={styles.preview} aria-live="polite">
					<Show when={titleMissing()}>
						<span class={styles.previewWarning}>
							只有符号没有标题，写点内容才能建
						</span>
					</Show>
					<Show when={parsed().priority}>
						{(priority) => (
							<span class={styles.chip}>{priority().toUpperCase()}</span>
						)}
					</Show>
					<For each={parsed().tags}>
						{(tag) => <span class={styles.chip}>#{tag}</span>}
					</For>
					<Show when={parsed().effortMinutes}>
						{(minutes) => <span class={styles.chip}>⏱{minutes()}m</span>}
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

			<Show when={expanded()}>
				<div id="capture-panel" class={styles.panel}>
					<DateField
						label="截止时间"
						value={dueAt()}
						onChange={setDueAt}
						testId="capture-due"
					/>
					<DateField
						label="开始时间"
						value={startAt()}
						onChange={setStartAt}
						testId="capture-start"
					/>

					<div class={styles.field}>
						<label class={styles.label} for="capture-priority">
							优先级
						</label>
						<Select
							id="capture-priority"
							value={parsed().priority ?? ""}
							onChange={(e) => {
								const value = e.currentTarget.value;
								setText(
									setPriorityToken(
										text(),
										value === "" ? null : (value as TaskPriority),
									),
								);
							}}
						>
							<option value="">（未设置）</option>
							<option value="p1">p1 · 最急</option>
							<option value="p2">p2</option>
							<option value="p3">p3</option>
							<option value="p4">p4</option>
						</Select>
					</div>

					<div class={styles.field}>
						<label class={styles.label} for={effortFieldId}>
							预计时长（分钟）
						</label>
						<Input
							id={effortFieldId}
							type="number"
							min="1"
							class={styles.effortInput}
							value={effortDraft()}
							onInput={(e) => setEffortDraft(e.currentTarget.value)}
							onChange={(e) => {
								const minutes = Number(e.currentTarget.value);
								setText(
									setEffortToken(
										text(),
										!minutes || minutes <= 0 ? null : Math.round(minutes),
									),
								);
							}}
						/>
					</div>

					<div class={styles.field}>
						<span class={styles.label}>标签</span>
						<TagInput
							selected={parsed().tags}
							onAdd={(name) => setText(addTagToken(text(), name))}
							onRemove={(name) => setText(removeTagToken(text(), name))}
							search={searchTags}
							placeholder="标签名（Enter 确认）"
							ariaLabel="给任务加标签"
						/>
					</div>

					<Show when={(props.parentCandidates?.length ?? 0) > 0}>
						<div class={styles.field}>
							<label class={styles.label} for="capture-parent">
								父任务
							</label>
							<Select
								id="capture-parent"
								value={parentId() ?? ""}
								onChange={(e) =>
									setParentId(
										e.currentTarget.value === ""
											? null
											: Number(e.currentTarget.value),
									)
								}
							>
								<option value="">（无）</option>
								<For each={props.parentCandidates}>
									{(candidate) => (
										<option value={candidate.id}>{candidate.title}</option>
									)}
								</For>
							</Select>
						</div>
					</Show>
				</div>
			</Show>
		</div>
	);
}

interface DateFieldProps {
	label: string;
	value: Date | null;
	onChange: (value: Date | null) => void;
	testId: string;
}

/**
 * 日期控件（MD3 契约）：文本输入 + 日历图标。
 *
 * - **打字是主路径**，日历图标只是可选的快捷方式（MD3：它"reduces the amount of
 *   key presses"，不是必经之路）
 * - **失焦或回车才解析并格式化**：输入过程中绝不改用户敲的字（禁输入掩码 —— MD3 的
 *   理由读屏用户听到的与看到的不一致）
 * - 格式写在下方 helper 里（不是 placeholder），格式规格见 lib/dateInput.ts
 * - 清空 = 把文本删光（"我设错了"是必需场景，不额外加清空按钮）
 */
function DateField(props: DateFieldProps) {
	let pickerRef: HTMLInputElement | undefined;
	let textRef: HTMLInputElement | undefined;
	const [draft, setDraft] = createSignal(
		props.value ? formatDateInput(props.value) : "",
	);
	const [invalid, setInvalid] = createSignal(false);

	// 外部（提交后重置）改了值：跟着走，但用户正在这个框里打字时不抢
	createEffect(() => {
		const value = props.value;
		if (document.activeElement !== textRef) {
			setDraft(value ? formatDateInput(value) : "");
			setInvalid(false);
		}
	});

	/** 失焦 / 回车才落定：认得出就格式化，认不出就标记无效（不偷偷丢掉用户写的字） */
	const commit = () => {
		const text = draft().trim();
		if (text === "") {
			setInvalid(false);
			props.onChange(null);
			return;
		}
		const date = parseDateInput(text);
		if (date) {
			setInvalid(false);
			setDraft(formatDateInput(date));
			props.onChange(date);
		} else {
			setInvalid(true);
		}
	};

	return (
		<div class={styles.field}>
			<label class={styles.label} for={props.testId}>
				{props.label}
			</label>
			<div class={styles.dateRow}>
				<Input
					ref={textRef}
					id={props.testId}
					class={styles.dateInput}
					value={draft()}
					placeholder="2026-10-03 15:00"
					invalid={invalid()}
					aria-describedby={`${props.testId}-helper`}
					onInput={(e) => {
						setDraft(e.currentTarget.value);
						setInvalid(false);
					}}
					onBlur={commit}
					onKeyDown={(e) => {
						if (isImeComposing(e)) {
							return;
						}
						if (e.key === "Enter") {
							// 回车只落定这个框，不提交整条（还在填属性）
							e.preventDefault();
							e.stopPropagation();
							commit();
						}
						if (e.key === "Escape") {
							// Esc 撤掉这一格的改动，也不冒泡去收面板
							e.stopPropagation();
							setDraft(props.value ? formatDateInput(props.value) : "");
							setInvalid(false);
						}
					}}
				/>
				<button
					type="button"
					class={styles.calendarButton}
					aria-label={`选择${props.label}`}
					onClick={() => {
						const picker = pickerRef;
						if (!picker) {
							return;
						}
						// showPicker 是可选能力：老浏览器上退回"点一下原生框"
						if (typeof picker.showPicker === "function") {
							picker.showPicker();
						} else {
							picker.focus();
						}
					}}
				>
					📅
				</button>
				<input
					ref={pickerRef}
					class={styles.picker}
					type="datetime-local"
					tabindex={-1}
					aria-label={`${props.label}（日历选择）`}
					value={toLocalInputValue(props.value)}
					onChange={(e) => {
						const picked = e.currentTarget.value;
						const date = picked ? new Date(picked) : null;
						if (date) {
							setDraft(formatDateInput(date));
						}
						setInvalid(false);
						props.onChange(date);
					}}
				/>
			</div>
			<span id={`${props.testId}-helper`} class={styles.helper}>
				{DATE_HELPER}
			</span>
		</div>
	);
}

/** `<input type="datetime-local">` 要的是本地 `YYYY-MM-DDTHH:mm`（不带时区） */
function toLocalInputValue(date: Date | null): string {
	if (!date) {
		return "";
	}
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
