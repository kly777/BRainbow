// ── 添加生日 / 纪念日 ──
//
// 公历出生日期是可选的辅助：填了就让后端换算农历年/月/日并回填；
// 用户也可以直接填农历月日。所有事件都是全天。

import { Button, Input, Modal, Select } from "@components/ui";
import { createMemo, createSignal, Show } from "solid-js";
import {
	type CalendarKind,
	convertLunarE,
	createEventSeriesE,
	type EventKind,
	type LunarDateInfo,
} from "../calendarApi.ts";
import styles from "./EventForm.module.css";

export interface EventFormProps {
	isOpen: boolean;
	onClose: () => void;
	onSaved: () => void;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function EventForm(props: EventFormProps) {
	const [title, setTitle] = createSignal("");
	const [kind, setKind] = createSignal<EventKind>("birthday");
	const [calendar, setCalendar] = createSignal<CalendarKind>("gregorian");
	const [month, setMonth] = createSignal("");
	const [day, setDay] = createSignal("");
	const [sinceOn, setSinceOn] = createSignal("");
	const [sinceYear, setSinceYear] = createSignal("");
	const [leapPolicy, setLeapPolicy] = createSignal<"regular" | "leap" | "skip">(
		"regular",
	);
	const [lunar, setLunar] = createSignal<LunarDateInfo | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [saving, setSaving] = createSignal(false);

	const isBirthdayLike = createMemo(
		() => kind() === "birthday" || kind() === "anniversary",
	);

	const applySinceOn = async (value: string) => {
		setSinceOn(value);
		setLunar(null);
		setError(null);
		if (!value) {
			return;
		}
		if (calendar() === "lunar") {
			try {
				const info = await convertLunarE(value);
				setLunar(info);
				setMonth(String(info.lunar_month));
				setDay(String(info.lunar_day));
				setSinceYear(String(info.lunar_year));
			} catch (err) {
				setError(err instanceof Error ? err.message : "农历换算失败");
			}
			return;
		}
		const date = new Date(`${value}T00:00:00`);
		if (!Number.isNaN(date.getTime())) {
			setMonth(String(date.getMonth() + 1));
			setDay(String(date.getDate()));
			setSinceYear(String(date.getFullYear()));
		}
	};

	const submit = async () => {
		setError(null);
		const name = title().trim();
		if (!name) {
			setError("标题不能为空");
			return;
		}
		const monthNumber = Number(month());
		const dayNumber = Number(day());
		if (
			!Number.isInteger(monthNumber) ||
			!Number.isInteger(dayNumber) ||
			monthNumber < 1 ||
			dayNumber < 1
		) {
			setError("请填写月份和日期");
			return;
		}
		const yearNumber = sinceYear().trim() ? Number(sinceYear()) : null;
		setSaving(true);
		try {
			await createEventSeriesE({
				title: name,
				kind: kind(),
				calendar: calendar(),
				month: monthNumber,
				day: dayNumber,
				leap_policy: calendar() === "lunar" ? leapPolicy() : null,
				missing_day_policy: "last_day",
				born_in_leap_month: lunar()?.is_leap_month ?? false,
				since_year: yearNumber,
				since_on: sinceOn() || null,
				all_day: true,
				busy: false,
				upcoming_days: 7,
				timezone: "Asia/Shanghai",
				starts_on: todayIso(),
			});
			setTitle("");
			setSinceOn("");
			setLunar(null);
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
			title="添加生日 / 纪念日"
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
				<label class={styles.label} for="event-title">
					标题
				</label>
				<Input
					id="event-title"
					value={title()}
					onInput={(e) => setTitle(e.currentTarget.value)}
					placeholder="妈妈生日 / 结婚纪念日"
					autofocus
				/>

				<div class={styles.row}>
					<div class={styles.field}>
						<label class={styles.label} for="event-kind">
							类型
						</label>
						<Select
							id="event-kind"
							value={kind()}
							onChange={(e) => setKind(e.currentTarget.value as EventKind)}
						>
							<option value="birthday">生日</option>
							<option value="anniversary">纪念日</option>
						</Select>
					</div>
					<div class={styles.field}>
						<label class={styles.label} for="event-calendar">
							历法
						</label>
						<Select
							id="event-calendar"
							value={calendar()}
							onChange={(e) =>
								setCalendar(e.currentTarget.value as CalendarKind)
							}
						>
							<option value="gregorian">公历</option>
							<option value="lunar">农历</option>
						</Select>
					</div>
				</div>

				<label class={styles.label} for="event-since-on">
					公历出生日期（可选，填了自动换算农历）
				</label>
				<Input
					id="event-since-on"
					type="date"
					value={sinceOn()}
					onChange={(e) => void applySinceOn(e.currentTarget.value)}
				/>

				<Show when={lunar()}>
					{(info) => (
						<p class={styles.hint}>
							{info().lunar_label}
							{info().is_leap_month ? "（闰月）" : ""}
						</p>
					)}
				</Show>

				<div class={styles.row}>
					<div class={styles.field}>
						<label class={styles.label} for="event-month">
							月份
						</label>
						<Input
							id="event-month"
							type="number"
							min="1"
							max="12"
							value={month()}
							onInput={(e) => setMonth(e.currentTarget.value)}
						/>
					</div>
					<div class={styles.field}>
						<label class={styles.label} for="event-day">
							日期
						</label>
						<Input
							id="event-day"
							type="number"
							min="1"
							max="31"
							value={day()}
							onInput={(e) => setDay(e.currentTarget.value)}
						/>
					</div>
					<div class={styles.field}>
						<label class={styles.label} for="event-year">
							出生/起始年（可选）
						</label>
						<Input
							id="event-year"
							type="number"
							placeholder="1968"
							value={sinceYear()}
							onInput={(e) => setSinceYear(e.currentTarget.value)}
						/>
					</div>
				</div>

				<Show when={calendar() === "lunar"}>
					<div class={styles.field}>
						<label class={styles.label} for="event-leap">
							闰月年怎么过
						</label>
						<Select
							id="event-leap"
							value={leapPolicy()}
							onChange={(e) =>
								setLeapPolicy(
									e.currentTarget.value as "regular" | "leap" | "skip",
								)
							}
						>
							<option value="regular">按正月（每年都过）</option>
							<option value="leap">只在闰月过</option>
							<option value="skip">闰月年跳过</option>
						</Select>
					</div>
				</Show>

				<Show when={!isBirthdayLike()}>
					<p class={styles.hint}>目前只支持生日与纪念日。</p>
				</Show>

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
