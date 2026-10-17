// ── 单个条件的编辑器 ──
//
// 任务行与录入框共用：传进来的是"当前条件值"和一个同步的 onChange，
// 这里只负责把某个控件翻译成 patch。落定即保存（列表走乐观更新），
// 所以没有"保存"按钮 —— 只有"移除这个条件"与"收起"。
//
// onChange 返回人话错误（例如计划晚于截止）时，编辑器把错误显示出来且**不**
// 假装保存成功；返回 null 才算落定。

import { Button, Input } from "@components/ui";
import TagInput, {
	type TagOption,
} from "@components/ui/molecules/TagInput.tsx";
import { isImeComposing } from "@shared/utils";
import {
	type Component,
	createEffect,
	createSignal,
	createUniqueId,
	For,
	Show,
} from "solid-js";
import type { TaskPriority } from "../api.ts";
import {
	CONDITION_LABELS,
	type ConditionKey,
	type ConditionValues,
	formatEffort,
	hasCondition,
} from "../lib/conditions.ts";
import { fromIso } from "../lib/dateInput.ts";
import styles from "./ConditionEditor.module.css";
import DateField from "./DateField.tsx";

const PRIORITIES: readonly { value: TaskPriority; label: string }[] = [
	{ value: "p1", label: "P1 · 最急" },
	{ value: "p2", label: "P2" },
	{ value: "p3", label: "P3" },
	{ value: "p4", label: "P4 · 最低" },
];

const EFFORT_PRESETS = [15, 30, 60, 90, 120] as const;

export interface ConditionEditorProps {
	condition: ConditionKey;
	values: ConditionValues;
	/** 返回错误人话；null = 已接受 */
	onChange: (patch: Partial<ConditionValues>) => string | null;
	onClose: () => void;
	/** 标签候选（与录入框同一套去抖搜索） */
	searchTags: (query: string) => Promise<TagOption[]>;
}

/** 日期 → 服务端 ISO；空 → null */
const isoOf = (date: Date | null): string | null =>
	date ? date.toISOString() : null;

const ConditionEditor: Component<ConditionEditorProps> = (props) => {
	const id = createUniqueId();
	const [error, setError] = createSignal<string | null>(null);
	const [effortDraft, setEffortDraft] = createSignal(
		props.values.effortMinutes === null
			? ""
			: String(props.values.effortMinutes),
	);

	// 外部值变了（乐观更新回来 / 另一个入口改了）跟着走，但别抢正在输入的人
	createEffect(() => {
		const minutes = props.values.effortMinutes;
		if (
			props.condition === "effort" &&
			document.activeElement?.id !== `${id}-effort`
		) {
			setEffortDraft(minutes === null ? "" : String(minutes));
		}
	});

	const apply = (patch: Partial<ConditionValues>): boolean => {
		const message = props.onChange(patch);
		setError(message);
		return message === null;
	};

	const remove = () => {
		switch (props.condition) {
			case "start":
				apply({ startAt: null });
				break;
			case "due":
				apply({ dueAt: null });
				break;
			case "priority":
				apply({ priority: null });
				break;
			case "effort":
				apply({ effortMinutes: null });
				break;
			case "tags":
				apply({ tags: [] });
				break;
		}
		props.onClose();
	};

	const commitEffort = () => {
		const raw = effortDraft().trim();
		if (raw === "") {
			if (apply({ effortMinutes: null })) {
				props.onClose();
			}
			return;
		}
		const minutes = Number(raw);
		if (!Number.isFinite(minutes) || minutes <= 0) {
			setError("时长要是正数");
			return;
		}
		if (apply({ effortMinutes: Math.round(minutes) })) {
			props.onClose();
		}
	};

	const title = CONDITION_LABELS[props.condition];
	const showRemove = () =>
		props.condition === "tags"
			? props.values.tags.length > 0
			: hasCondition(props.values, props.condition);

	return (
		<fieldset
			class={styles.editor}
			aria-label={`编辑${title}`}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					props.onClose();
				}
			}}
		>
			<div class={styles.header}>
				<span class={styles.title}>{title}</span>
				<div class={styles.headerActions}>
					<Show when={showRemove()}>
						<button
							type="button"
							class={styles.remove}
							onClick={remove}
							aria-label={`移除${title}`}
						>
							{props.condition === "tags" ? "清除全部" : "移除"}
						</button>
					</Show>
					<button
						type="button"
						class={styles.done}
						onClick={props.onClose}
						aria-label={`收起${title}编辑`}
					>
						完成
					</button>
				</div>
			</div>

			<Show when={props.condition === "start" || props.condition === "due"}>
				<DateField
					id={`${id}-date`}
					label={title}
					hideLabel
					value={fromIso(
						props.condition === "start"
							? props.values.startAt
							: props.values.dueAt,
					)}
					onChange={(date) => {
						const iso = isoOf(date);
						apply(
							props.condition === "start" ? { startAt: iso } : { dueAt: iso },
						);
					}}
					autoFocus
				/>
			</Show>

			<Show when={props.condition === "priority"}>
				<div class={styles.priorityRow}>
					<For each={PRIORITIES}>
						{(priority) => (
							<button
								type="button"
								class={styles.priority}
								classList={{
									[styles.priorityActive]:
										props.values.priority === priority.value,
								}}
								aria-pressed={props.values.priority === priority.value}
								onClick={() => {
									if (apply({ priority: priority.value })) {
										props.onClose();
									}
								}}
							>
								{priority.label}
							</button>
						)}
					</For>
				</div>
			</Show>

			<Show when={props.condition === "effort"}>
				<div class={styles.effortRow}>
					<Input
						id={`${id}-effort`}
						type="number"
						min="1"
						class={styles.effortInput}
						value={effortDraft()}
						onInput={(e) => {
							setEffortDraft(e.currentTarget.value);
							setError(null);
						}}
						onKeyDown={(e) => {
							if (isImeComposing(e)) {
								return;
							}
							if (e.key === "Enter") {
								e.preventDefault();
								commitEffort();
							}
						}}
						onBlur={commitEffort}
						aria-label="预计时长（分钟）"
						autofocus
					/>
					<span class={styles.unit}>分钟</span>
					<div class={styles.presets}>
						<For each={EFFORT_PRESETS}>
							{(minutes) => (
								<Button
									variant="ghost"
									size="sm"
									class={styles.preset}
									onClick={() => {
										if (apply({ effortMinutes: minutes })) {
											props.onClose();
										}
									}}
								>
									{formatEffort(minutes)}
								</Button>
							)}
						</For>
					</div>
				</div>
			</Show>

			<Show when={props.condition === "tags"}>
				<TagInput
					selected={props.values.tags}
					onAdd={(name) => {
						if (!props.values.tags.includes(name)) {
							apply({ tags: [...props.values.tags, name] });
						}
					}}
					onRemove={(name) =>
						apply({
							tags: props.values.tags.filter((tag) => tag !== name),
						})
					}
					search={props.searchTags}
					placeholder="标签名（Enter 确认）"
					ariaLabel={`给任务加标签`}
				/>
			</Show>

			<Show when={error()}>
				{(message) => (
					<p class={styles.error} role="alert">
						{message()}
					</p>
				)}
			</Show>
		</fieldset>
	);
};

export default ConditionEditor;
