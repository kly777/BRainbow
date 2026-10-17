// ── 日期文本控件（MD3 契约）──
//
// 从 CaptureInput 里抽出来：录入框与任务行的"计划时间 / 截止时间"是**同一个控件**。
// 两条规则不因宿主而变：
//
// 1. **打字是主路径，日历只是入口**：MD3 把「Enter dates manually by inputting text」
//    列为第一条用例，日历图标只是"可选的快捷方式"。
// 2. **失焦/回车才格式化，输入过程中不格式化**（禁输入掩码）：MD3 的原话是输入掩码
//    "changes what they typed" —— 读屏用户听到的与看到的不一致就是这条的真实理由。
//
// 因此这里不负责"保存"，只把认出来的 Date 交给 onChange；认不出就标记无效，
// 不偷偷丢掉用户写的字。

import { Input } from "@components/ui";
import { isImeComposing } from "@shared/utils";
import { createEffect, createSignal, onMount } from "solid-js";
import {
	DATE_HELPER,
	formatDateInput,
	parseDateInput,
	toDateInputValue,
} from "../lib/dateInput.ts";
import styles from "./DateField.module.css";

export interface DateFieldProps {
	/** 输入框 id（也是 helper 的 aria-describedby 基名） */
	id: string;
	label: string;
	value: Date | null;
	onChange: (value: Date | null) => void;
	/** 打开编辑器时把焦点放进文本框（表单里第一个字段用） */
	autoFocus?: boolean;
	/** 宿主已经有标签时不再重复渲染一遍（条件编辑器用） */
	hideLabel?: boolean;
}

export default function DateField(props: DateFieldProps) {
	let pickerRef: HTMLInputElement | undefined;
	let textRef: HTMLInputElement | undefined;
	const [draft, setDraft] = createSignal(
		props.value ? formatDateInput(props.value) : "",
	);
	const [invalid, setInvalid] = createSignal(false);

	// 外部（提交后重置 / 乐观更新回来）改了值：跟着走，但用户正在这个框里打字时不抢
	createEffect(() => {
		const value = props.value;
		if (document.activeElement !== textRef) {
			setDraft(value ? formatDateInput(value) : "");
			setInvalid(false);
		}
	});

	onMount(() => {
		if (props.autoFocus) {
			textRef?.focus();
			textRef?.select();
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
			{!props.hideLabel && (
				<label class={styles.label} for={props.id}>
					{props.label}
				</label>
			)}
			<div class={styles.dateRow}>
				<Input
					ref={textRef}
					id={props.id}
					class={styles.dateInput}
					value={draft()}
					placeholder="2026-10-03 15:00"
					invalid={invalid()}
					aria-describedby={`${props.id}-helper`}
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
					value={toDateInputValue(props.value)}
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
			<span id={`${props.id}-helper`} class={styles.helper}>
				{DATE_HELPER}
			</span>
		</div>
	);
}
