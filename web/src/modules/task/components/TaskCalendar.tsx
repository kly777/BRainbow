// 月网格：跨日条 + 三通道语义 + 常驻徽标 + 单 Tab 停靠的 a11y 骨架。
//
// **五个部件的位置都常驻**（日期数字 / 徽标 / 事件条 / 折叠行 / 断口），不靠 hover
// 才出现 —— WAI-ARIA APG 对焦点环与 hover 态有明确要求，"hover 才出现"会让
// 键盘用户和鼠标用户看到两套界面；同理会重排格子（S4-k）。
//
// **三通道语义**（06-日历视图 §5.2）：边框样式 = 时间窗类型、底色 = 任务状态、
// 角标 = 优先级。任一语义都有非颜色通道，所以灰度截图下仍可区分（S4-c）。

import { Tooltip } from "@components/ui";
import { ChevronLeft, ChevronRight } from "@components/ui/icons";
import {
	type Component,
	createEffect,
	createSignal,
	For,
	Show,
} from "solid-js";
import type { CalendarEvent } from "../api.ts";
import type { ExternalEvent } from "../calendarApi.ts";
import type { TaskCalendarApi } from "../hooks/useTaskCalendar.ts";
import {
	type DaySegment,
	dayKey,
	formatDuration,
	formatSegmentTime,
	hasFeasible,
	hasOverdue,
} from "../lib/calendar.ts";
import styles from "./TaskCalendar.module.css";

/** 事件条：时间前缀 + 标题 + 优先级角标 + 跨日断口 */
const EventBar: Component<{
	segment: DaySegment;
	onOpen: (taskId: number) => void;
}> = (props) => {
	const ev = () => props.segment.event;
	const windowClass = () => {
		switch (ev().window_type) {
			case "actual":
				return styles.typeActual;
			case "feasible":
				return styles.typeFeasible;
			default:
				return styles.typePlanned;
		}
	};
	// 状态另有冗余：completed 带删除线（所以底色不是唯一通道）
	const statusClass = () => {
		switch (ev().status) {
			case "active":
				return styles.statusActive;
			case "completed":
				return styles.statusCompleted;
			default:
				return styles.statusBacklog;
		}
	};

	return (
		<button
			type="button"
			class={`${styles.eventBar} ${windowClass()} ${statusClass()}`}
			classList={{
				[styles.continuesFromPrev]: props.segment.continuesFromPrev,
				[styles.continuesToNext]: props.segment.continuesToNext,
				// 只显示优先级角标：p3/p4 在密集列表里是噪音（06 §5.2）
				[styles.hasPriority]: ev().priority === "p1" || ev().priority === "p2",
			}}
			// 事件条是网格里的可聚焦元素（APG：每格要么含可聚焦元素，要么自身可聚焦）
			tabindex={-1}
			onClick={() => props.onOpen(ev().task_id)}
			title={[
				ev().title,
				STATUS_LABELS[ev().status] ?? ev().status,
				windowTypeLabel(ev().window_type),
				`${timeRange(props.segment)}（${formatDuration(
					Math.max(0, props.segment.endMinute - props.segment.startMinute),
				)}）`,
			].join(" · ")}
		>
			{/* 续接那天不显示时间前缀：显示"00:00"是误导（段从那天零点开始是几何事实） */}
			<Show when={!props.segment.continuesFromPrev}>
				<span class={styles.eventTime}>{formatSegmentTime(props.segment)}</span>
			</Show>
			<span class={styles.eventTitle}>{ev().title}</span>
			<Show when={ev().priority === "p1" || ev().priority === "p2"}>
				{/* abbr 而不是 span：span 没有 role，aria-label 会被读屏忽略；
				    abbr 的 title 是读屏会念出来的（形状 + 文字双通道） */}
				<abbr class={styles.priorityMark} title={`优先级 ${ev().priority}`}>
					{ev().priority === "p1" ? "▪" : "▫"}
				</abbr>
			</Show>
		</button>
	);
};

/** 状态的中文名（tooltip 用；日历时颜色只承载它的一半，文字这半在这儿补齐） */
const STATUS_LABELS: Record<string, string> = {
	backlog: "待办",
	active: "进行中",
	completed: "已完成",
	archived: "已归档",
};

function windowTypeLabel(type: string): string {
	switch (type) {
		case "planned":
			return "已安排";
		case "actual":
			return "实际";
		case "feasible":
			return "可行";
		default:
			return type;
	}
}

function timeRange(segment: DaySegment): string {
	const end = segment.endMinute % (24 * 60);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(Math.floor(segment.startMinute / 60))}:${pad(segment.startMinute % 60)}–${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
}

const CalendarDayCell: Component<{
	index: number;
	date: Date | null;
	weekend: boolean;
	today: boolean;
	segments: readonly DaySegment[];
	events: readonly CalendarEvent[];
	/** 独立日程：生日/纪念日/节日（不属于 task，不参与任务事件条） */
	externalEvents: readonly ExternalEvent[];
	collapsedCount: number;
	/** roving tabindex：当前格 tabindex=0，其余 -1 → 整个网格只占一个 Tab 停靠点 */
	isFocusedCell: boolean;
	registerCell: (index: number, node: HTMLTableCellElement | null) => void;
	onFocusCell: () => void;
	onKeyDown: (e: KeyboardEvent, index: number) => void;
	onOpenTask: (taskId: number) => void;
}> = (props) => {
	const visible = () => props.segments.slice(0, props.collapsedCount);
	const overflow = () => props.segments.length - visible().length;

	return (
		<td
			ref={(node) => props.registerCell(props.index, node)}
			classList={{
				[styles.calendarDay]: true,
				[styles.today]: props.today,
				[styles.outsideMonth]: props.date === null,
				[styles.weekend]: props.weekend,
			}}
			// 补位格**可聚焦但不可操作**（APG）；焦点由 roving tabindex 统一管理。
			// <td> 隐含 role=gridcell，不必再写 role
			tabindex={props.isFocusedCell ? 0 : -1}
			aria-label={props.date ? dateAriaLabel(props.date) : "补位格"}
			aria-disabled={props.date === null}
			onFocus={props.onFocusCell}
			onKeyDown={(e) => props.onKeyDown(e, props.index)}
		>
			<Show when={props.date}>
				<div class={styles.dayHeaderRow}>
					<span class={styles.dayNumber}>{props.date?.getDate()}</span>
					{/* 徽标位置常驻（宽度固定）：内容变多变少都不重排 */}
					<span class={styles.dayBadges}>
						{/* S4-d：逾期只有 ⚠ 图标承载，不铺一层红（WCAG 1.4.1） */}
						<Show when={hasOverdue(props.events)}>
							<abbr class={styles.badgeOverdue} title="这天有逾期未完成">
								⚠
							</abbr>
						</Show>
						{/* S4-f：feasible 只画存在性，不当安排 */}
						<Show when={hasFeasible(props.events)}>
							<abbr
								class={styles.badgeFeasible}
								title="这天有时段可选（还不是安排）"
							>
								▫
							</abbr>
						</Show>
					</span>
				</div>
				<div class={styles.dayEvents}>
					<For each={visible()}>
						{(segment) => (
							<EventBar segment={segment} onOpen={props.onOpenTask} />
						)}
					</For>
					{/* 独立日程：生日/纪念日/节日。不占任务事件条的位置，也不参与折叠计数 */}
					<For each={props.externalEvents}>
						{(event) => (
							<span
								class={styles.externalEvent}
								data-kind={event.kind}
								title={[
									event.title,
									event.age !== null ? `${event.age} 岁` : "",
									event.years !== null ? `${event.years} 周年` : "",
								]
									.filter(Boolean)
									.join(" · ")}
							>
								{event.kind === "birthday" ? "🎂 " : ""}
								{event.title}
							</span>
						)}
					</For>
					{/* 折叠行常占位：内容是"+N 更多"，不 hover 才出现 */}
					<Show when={overflow() > 0}>
						<span class={styles.moreRow}>+{overflow()} 更多</span>
					</Show>
				</div>
			</Show>
		</td>
	);
};

/** 日期格的 aria-label 要念出完整日期（"10月3日 周六"），不是只有"3"（MD3） */
function dateAriaLabel(date: Date): string {
	return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_NAMES[date.getDay()]}`;
}

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export interface TaskCalendarProps {
	/**
	 * 日历状态由调用方建好后传进来（TaskPanel 持有唯一一份）。
	 * 不在这里自己 `useTaskCalendar()`：每个实例各持一份状态、各发一次请求，
	 * 设置条与网格就会各改各的。
	 */
	calendar: TaskCalendarApi;
	/** 点事件 → 打开任务详情（抽屉在调用方，不在日历里，避免遮住网格） */
	onOpenTask?: (taskId: number) => void;
}

export default function TaskCalendar(props: TaskCalendarProps) {
	// 调用方建一次、整个生命周期不变，所以这里直接取出来用（不必每次 props.calendar）
	const m = props.calendar;
	// roving tabindex：整个网格只占一个 Tab 停靠点，方向键在格间移动（APG Grid）
	const [focusedIndex, setFocusedIndex] = createSignal(0);
	const cellRefs: HTMLTableCellElement[] = [];

	const registerCell = (index: number, node: HTMLTableCellElement | null) => {
		if (node) {
			cellRefs[index] = node;
		}
	};

	/** 换月后焦点回到第一天，避免落在不属于新月份的旧索引上 */
	createEffect(() => {
		m.grid();
		setFocusedIndex(0);
	});

	const focusCell = (index: number) => {
		const cells = m.grid();
		if (index < 0 || index >= cells.length) {
			return;
		}
		setFocusedIndex(index);
		cellRefs[index]?.focus();
	};

	/** 方向键在格间移动（1 周 = 7 格）。补位格也吃焦点，否则 Tab 会跳出去 */
	const onGridKeyDown = (e: KeyboardEvent, index: number) => {
		const total = m.grid().length;
		const row = Math.floor(index / 7);
		const col = index % 7;
		const lastRow = Math.floor((total - 1) / 7);

		let target: number | null = null;
		if (e.key === "ArrowRight") {
			// 行末往右不跨行（APG layout grid 的换行约定）
			target = col === 6 ? null : index + 1;
		} else if (e.key === "ArrowLeft") {
			target = col === 0 ? null : index - 1;
		} else if (e.key === "ArrowDown") {
			target = row === lastRow ? null : index + 7;
		} else if (e.key === "ArrowUp") {
			target = row === 0 ? null : index - 7;
		}
		if (target === null) {
			return;
		}
		e.preventDefault();
		focusCell(target);
	};

	const openTask = (taskId: number) => props.onOpenTask?.(taskId);

	return (
		<div class={styles.calendarView}>
			<div class={styles.calendarHeader}>
				<button
					type="button"
					onClick={() => m.changeMonth(-1)}
					class={styles.navButton}
					aria-label="上个月"
				>
					<ChevronLeft size={14} /> 上月
				</button>
				<h2 class={styles.calendarTitle} aria-live="polite">
					{m.monthTitle()}
				</h2>
				<button
					type="button"
					onClick={() => m.changeMonth(1)}
					class={styles.navButton}
					aria-label="下个月"
				>
					下月 <ChevronRight size={14} />
				</button>
				{/* S4-7：翻到远处之后没它回不来 */}
				<Tooltip label="回到今天">
					<button
						type="button"
						onClick={() => {
							m.goToToday();
							focusCell(0);
						}}
						class={styles.todayButton}
					>
						今天
					</button>
				</Tooltip>
			</div>

			{/* APG Grid：真实 table + role=grid。整个网格只占**一个** Tab 停靠点，
			    格内用 roving tabindex 移动焦点（不是 42 个格子按 42 次 Tab）。 */}
			{/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: role=grid 配真实 <table> 正是 WAI-ARIA APG 的 Grid 模式写法（表用 table、行用 tr、格用 td），比 div + role 更好：读屏的心智模型一致，且不需要逐个补 role */}
			<table role="grid" class={styles.calendarGrid} aria-label="月历">
				<thead>
					<tr class={styles.headerRow}>
						<For each={m.weekdayLabels()}>
							{(label, col) => (
								<th
									scope="col"
									class={styles.dayHeader}
									classList={{
										[styles.weekendHeader]: m.isWeekendCol(col()),
									}}
								>
									<span class={styles.headerFull}>{label}</span>
									<span class={styles.headerShort}>
										{m.weekdayShortLabels()[col()]}
									</span>
								</th>
							)}
						</For>
					</tr>
				</thead>
				<tbody>
					<For each={chunkRows(m.grid())}>
						{(row, rowIndex) => (
							<tr class={styles.gridRow}>
								<For each={row}>
									{(cell, colInRow) => {
										const index = () => rowIndex() * 7 + colInRow();
										return (
											<CalendarDayCell
												index={index()}
												date={cell.date}
												weekend={m.isWeekendCol(colInRow())}
												today={m.isToday(cell.date)}
												segments={
													cell.date ? m.segmentsFor(dayKey(cell.date)) : []
												}
												events={cell.date ? m.eventsFor(dayKey(cell.date)) : []}
												externalEvents={
													cell.date
														? m.externalEventsFor(dayKey(cell.date))
														: []
												}
												collapsedCount={m.collapsedCount()}
												isFocusedCell={index() === focusedIndex()}
												registerCell={registerCell}
												onFocusCell={() => setFocusedIndex(index())}
												onKeyDown={onGridKeyDown}
												onOpenTask={openTask}
											/>
										);
									}}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	);
}

/** 网格按 7 一行切开（APG 的 `role="row"` 需要真的行容器，不能靠 CSS 撑） */
function chunkRows<T>(cells: readonly T[]): T[][] {
	const rows: T[][] = [];
	for (let i = 0; i < cells.length; i += 7) {
		rows.push(cells.slice(i, i + 7));
	}
	return rows;
}
