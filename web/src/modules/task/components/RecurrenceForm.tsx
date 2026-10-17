// ── 把一条任务设为循环：创建 task_series，由后端生成 occurrence ──

import { Button, Input, Modal, Select } from "@components/ui";
import { createSignal, For, Show } from "solid-js";
import type { Task } from "../api-types.ts";
import {
	createTaskSeriesE,
	type RecurrenceFrequency,
} from "../taskSeriesApi.ts";
import styles from "./RecurrenceForm.module.css";

const WEEKDAYS = [
	{ value: 1, label: "一" },
	{ value: 2, label: "二" },
	{ value: 3, label: "三" },
	{ value: 4, label: "四" },
	{ value: 5, label: "五" },
	{ value: 6, label: "六" },
	{ value: 7, label: "日" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

export interface RecurrenceFormProps {
	task: Task;
	isOpen: boolean;
	onClose: () => void;
	onSaved: () => void;
}

export default function RecurrenceForm(props: RecurrenceFormProps) {
	const [freq, setFreq] = createSignal<RecurrenceFrequency>("weekly");
	const [interval, setInterval] = createSignal("1");
	const [weekdays, setWeekdays] = createSignal<number[]>([
		new Date().getDay() === 0 ? 7 : new Date().getDay(),
	]);
	const [startsOn, setStartsOn] = createSignal(todayIso());
	const [dueTime, setDueTime] = createSignal("");
	const [anchor, setAnchor] = createSignal<"due" | "completion">("due");
	const [error, setError] = createSignal<string | null>(null);
	const [saving, setSaving] = createSignal(false);

	const toggleWeekday = (day: number) => {
		setWeekdays((current) =>
			current.includes(day)
				? current.filter((value) => value !== day)
				: [...current, day].sort((a, b) => a - b),
		);
	};

	const submit = async () => {
		setError(null);
		const intervalValue = Number(interval());
		if (!Number.isInteger(intervalValue) || intervalValue < 1) {
			setError("间隔必须是正整数");
			return;
		}
		if (freq() === "weekly" && weekdays().length === 0) {
			setError("每周重复至少要选一天");
			return;
		}
		const minutes = dueTime()
			? Number(dueTime().slice(0, 2)) * 60 + Number(dueTime().slice(3, 5))
			: null;
		setSaving(true);
		try {
			await createTaskSeriesE({
				title: props.task.title,
				description: props.task.description,
				priority: props.task.priority,
				effort_estimate_minutes: props.task.effort_estimate_minutes,
				recurrence: {
					calendar: "gregorian",
					freq: freq(),
					interval: intervalValue,
					by_weekdays: freq() === "weekly" ? weekdays() : undefined,
				},
				recurrence_anchor: anchor(),
				starts_on: startsOn(),
				due_time_minutes: minutes,
			});
			props.onSaved();
			props.onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "保存失败");
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal
			isOpen={props.isOpen}
			onClose={props.onClose}
			title={`设为循环：${props.task.title}`}
			actions={
				<>
					<Button variant="secondary" onClick={props.onClose}>
						取消
					</Button>
					<Button variant="primary" onClick={submit} disabled={saving()}>
						{saving() ? "保存中…" : "保存"}
					</Button>
				</>
			}
		>
			<div class={styles.form}>
				<div class={styles.row}>
					<div class={styles.field}>
						<label class={styles.label} for="recurrence-freq">
							频率
						</label>
						<Select
							id="recurrence-freq"
							value={freq()}
							onChange={(e) =>
								setFreq(e.currentTarget.value as RecurrenceFrequency)
							}
						>
							<option value="daily">每天</option>
							<option value="weekly">每周</option>
							<option value="monthly">每月</option>
							<option value="yearly">每年</option>
						</Select>
					</div>
					<div class={styles.field}>
						<label class={styles.label} for="recurrence-interval">
							间隔
						</label>
						<Input
							id="recurrence-interval"
							type="number"
							min="1"
							value={interval()}
							onInput={(e) => setInterval(e.currentTarget.value)}
						/>
					</div>
					<div class={styles.field}>
						<label class={styles.label} for="recurrence-start">
							开始日期
						</label>
						<Input
							id="recurrence-start"
							type="date"
							value={startsOn()}
							onInput={(e) => setStartsOn(e.currentTarget.value)}
						/>
					</div>
				</div>

				<Show when={freq() === "weekly"}>
					<div class={styles.field}>
						<span class={styles.label}>星期</span>
						<div class={styles.weekdays}>
							<For each={WEEKDAYS}>
								{(day) => (
									<label class={styles.weekday}>
										<input
											type="checkbox"
											checked={weekdays().includes(day.value)}
											onChange={() => toggleWeekday(day.value)}
										/>
										{day.label}
									</label>
								)}
							</For>
						</div>
					</div>
				</Show>

				<div class={styles.row}>
					<div class={styles.field}>
						<label class={styles.label} for="recurrence-time">
							截止钟点（可选）
						</label>
						<Input
							id="recurrence-time"
							type="time"
							value={dueTime()}
							onInput={(e) => setDueTime(e.currentTarget.value)}
						/>
					</div>
					<div class={styles.field}>
						<label class={styles.label} for="recurrence-anchor">
							下一次由什么决定
						</label>
						<Select
							id="recurrence-anchor"
							value={anchor()}
							onChange={(e) =>
								setAnchor(e.currentTarget.value as "due" | "completion")
							}
						>
							<option value="due">按日期</option>
							<option value="completion">按完成时间</option>
						</Select>
					</div>
				</div>

				<Show when={error()}>
					{(message) => (
						<p class={styles.error} role="alert">
							{message()}
						</p>
					)}
				</Show>
			</div>
		</Modal>
	);
}
