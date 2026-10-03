// 日历设置条：周起始日 + 密度档。
//
// 位置在日历**上方**而不是主工具条：这两项只影响日历这一块，放进主工具条会让
// 「任一时刻 ≤5 个常驻控件」那条预算被日历的设置吃掉（06-日历视图 §2）。
//
// **周起始日与密度都是设置项**（不只是常量）：只按 locale 推导不够 ——
// Google 日历就是把这两件事做成了用户设置，我们照做；默认仍跟随 locale。
//
// 注意这里**不自己调 useTaskCalendar**：hook 持有 currentDate/密度/焦点等状态，
// 每个实例各一份、各自发一次请求。状态由 TaskPanel 建好后当 prop 传下来。

import { Select } from "@components/ui";
import { For } from "solid-js";
import type { TaskCalendarApi } from "../hooks/useTaskCalendar.ts";
import type { CalendarDensity, Weekday } from "../lib/calendar.ts";
import styles from "./TaskCalendar.module.css";

/** 起始日选项：`跟随区域设置` = null（CLDR firstDay），其余是显式选择 */
const WEEK_OPTIONS: readonly { value: string; label: string }[] = [
	{ value: "auto", label: "跟随区域设置" },
	{ value: "mon", label: "周一" },
	{ value: "tue", label: "周二" },
	{ value: "wed", label: "周三" },
	{ value: "thu", label: "周四" },
	{ value: "fri", label: "周五" },
	{ value: "sat", label: "周六" },
	{ value: "sun", label: "周日" },
];

/** 与 `lib/calendar.ts` 的 WEEK_KEYS 同序（周一起的编号 → 深链接用的键） */
const WEEK_KEY_BY_DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const DENSITY_OPTIONS: readonly { value: CalendarDensity; label: string }[] = [
	{ value: "compact", label: "紧凑（每格 3 条）" },
	{ value: "standard", label: "标准（每格 5 条）" },
];

export default function CalendarSettings(props: { calendar: TaskCalendarApi }) {
	const m = () => props.calendar;

	return (
		<div class={styles.settingsBar}>
			<span class={styles.settingsItem}>
				{/* label 用 for 关联而不是包住控件：包裹式 label 会在 Select
				    渲染出真实 <select> 时被 lint 判成"没有关联控件"，也读屏上
				    更容易断链 */}
				<label class={styles.settingsLabel} for="calendar-week-start">
					周起始
				</label>
				{/* 显示的是「显式选过什么」而不是「实际生效的是哪天」——
				    否则选了周一时下拉里显示"周一"，用户分不清这是自己选的
				    还是 locale 推出来的，就再也找不到"跟随区域设置"这一项了 */}
				<Select
					id="calendar-week-start"
					value={
						m().weekStartSetting() === null
							? "auto"
							: WEEK_KEY_BY_DOW[m().weekStartSetting() as Weekday]
					}
					onChange={(e) => {
						const value = e.currentTarget.value;
						// `auto` = 交回 locale（存 null），其余是显式选择
						m().setFirstDay(
							value === "auto"
								? null
								: (WEEK_KEY_BY_DOW.indexOf(value) as Weekday),
						);
					}}
				>
					<For each={WEEK_OPTIONS}>
						{(option) => <option value={option.value}>{option.label}</option>}
					</For>
				</Select>
			</span>

			<span class={styles.settingsItem}>
				<label class={styles.settingsLabel} for="calendar-density">
					密度
				</label>
				<Select
					id="calendar-density"
					value={m().density()}
					onChange={(e) =>
						m().setDensity(e.currentTarget.value as CalendarDensity)
					}
				>
					<For each={DENSITY_OPTIONS}>
						{(option) => <option value={option.value}>{option.label}</option>}
					</For>
				</Select>
			</span>
		</div>
	);
}
