// 周/日时间轴：小时刻度 + 事件块 + 全天行。
//
// 事件块的位置与宽度全部由 `lib/calendarAxis.ts` 算好（像素映射 + 贪心重叠布局），
// 这里只负责渲染 —— 与月网格同一个分工。
//
// **块高度 ∝ 时长，但不低于 24px**（WCAG 2.5.8：日期格是触摸目标的例外，事件块不是）。
// 同一时刻多段就并排（列宽 = 1/列数），列数由最大同时重叠数决定。
//
// **`feasible` 不画进时间轴**：它是"我大概有空"这种元信息，画进去会让人误以为
// 那是安排（06-日历视图 §5.2）。它只出现在月网格的存在性徽标与全天行里。

import { Tooltip } from "@components/ui";
import { type Component, createEffect, createMemo, For, Show } from "solid-js";
import type { CalendarEvent } from "../api-types.ts";
import type { TaskCalendarApi } from "../hooks/useTaskCalendar.ts";
import { dayKey, isSameDay, MINUTES_PER_DAY } from "../lib/calendar.ts";
import {
	type AxisBlock,
	blockHeight,
	blockSize,
	hourMarks,
	type LaidOutBlock,
	layoutOverlaps,
	minutesToPixels,
	projectToDay,
} from "../lib/calendarAxis.ts";
import styles from "./CalendarTimeGrid.module.css";

/** 整天的轴高度（1440 分钟 × 每分钟像素） */
const DAY_HEIGHT = minutesToPixels(MINUTES_PER_DAY);

/** S5-a：打开就滚到当前时刻（或工作时段起点 09:00），取较早者 */
const WORKDAY_START_MINUTE = 9 * 60;

interface AxisDayColumnProps {
	dayIndex: number;
	today: boolean;
	segments: readonly AxisBlock[];
	nowMinute: number | null;
	onOpenTask: (taskId: number) => void;
}

const AxisDayColumn: Component<AxisDayColumnProps> = (props) => {
	// 重叠布局：列数 = 最大同时重叠数（贪心的最优性保证）
	const laid = createMemo(() => layoutOverlaps(props.segments));

	return (
		<div
			class={styles.dayColumn}
			classList={{
				[styles.today]: props.today,
				[styles.weekendCol]: props.dayIndex === 0 || props.dayIndex === 6,
			}}
		>
			{/* 小时横线：纯背景，事件块画在它上面 */}
			<div class={styles.hourLines} aria-hidden="true">
				<For each={hourMarks()}>
					{(mark) => (
						<div class={styles.hourLine} style={{ top: `${mark.top}px` }} />
					)}
				</For>
			</div>

			<For each={laid()}>
				{(block) => <EventBlock block={block} onOpenTask={props.onOpenTask} />}
			</For>

			{/* 当前时间线：只在"今天"这一列画。
			    三元而不是 `today && nowMinute !== null` —— 后者的类型是 boolean，
			    Show 的收窄回调就拿不到数字了 */}
			<Show when={props.today ? props.nowMinute : null}>
				{(minute) => (
					<div
						class={styles.nowLine}
						style={{ top: `${minutesToPixels(minute())}px` }}
						aria-hidden="true"
					/>
				)}
			</Show>
		</div>
	);
};

/** 一个事件块：高度 ∝ 时长，宽度按重叠列数分 */
const EventBlock: Component<{
	block: LaidOutBlock;
	onOpenTask: (taskId: number) => void;
}> = (props) => {
	const height = () => blockHeight(props.block);
	const size = () => blockSize(props.block.endMinute - props.block.startMinute);
	const clock = (m: number) =>
		`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

	return (
		<Tooltip
			label={`${props.block.title} · ${clock(props.block.startMinute)}–${clock(props.block.endMinute)}`}
		>
			<button
				type="button"
				class={styles.eventBlock}
				classList={{
					[styles.typePlanned]: props.block.windowType === "planned",
					[styles.typeActual]: props.block.windowType === "actual",
					[styles.statusActive]: props.block.status === "active",
					[styles.statusCompleted]: props.block.status === "completed",
					[styles.statusBacklog]:
						props.block.status !== "active" &&
						props.block.status !== "completed",
					// 分档只改**放几行字**，不改块高度（MD3：压缩可点击目标有代价）。
					// 只有 "tiny" 需要专门样式（放不下时间前缀），short/medium/long 同款
					[styles.sizeTiny]: size() === "tiny",
				}}
				style={{
					top: `${minutesToPixels(props.block.startMinute)}px`,
					height: `${height()}px`,
					left: `${(props.block.column / props.block.columns) * 100}%`,
					width: `${(1 / props.block.columns) * 100}%`,
				}}
				onClick={() => props.onOpenTask(props.block.taskId)}
			>
				<span class={styles.blockTime}>{clock(props.block.startMinute)}</span>
				<span class={styles.blockTitle}>{props.block.title}</span>
			</button>
		</Tooltip>
	);
};

export interface CalendarTimeGridProps {
	calendar: TaskCalendarApi;
	onOpenTask?: (taskId: number) => void;
}

export default function CalendarTimeGrid(props: CalendarTimeGridProps) {
	const m = props.calendar;
	let scrollerRef: HTMLDivElement | undefined;

	const today = new Date();
	const nowMinute = () => {
		const now = new Date();
		return now.getHours() * 60 + now.getMinutes();
	};

	/** 某天的段 → 轴上的块（跨天事件按当天裁） */
	const blocksForDay = (day: Date): AxisBlock[] =>
		m
			.segmentsFor(dayKey(day))
			.map((segment) => ({
				id: segment.event.task_id,
				taskId: segment.event.task_id,
				title: segment.event.title,
				windowType: segment.event.window_type,
				status: segment.event.status,
				priority: segment.event.priority,
				startIso: segment.event.start,
				endIso: segment.event.end,
				...projectToDay(segment, 0),
			}))
			// `feasible` 是元信息，不画成安排（只在月网格/全天行出现）
			.filter((block) => block.windowType !== "feasible");

	/** S5-3：全天行 = 跨过 24 点（或长于一格）的段 */
	const allDayBlocks = createMemo(() => {
		const seen = new Map<number, AxisBlock>();
		for (const segment of m.segmentsFor(dayKey(today))) {
			const event: CalendarEvent = segment.event;
			const start = new Date(event.start);
			const end = new Date(event.end);
			const spansDays =
				start.getFullYear() !== end.getFullYear() ||
				start.getMonth() !== end.getMonth() ||
				start.getDate() !== end.getDate();
			if (spansDays && !seen.has(event.task_id)) {
				seen.set(event.task_id, {
					id: event.task_id,
					taskId: event.task_id,
					title: event.title,
					windowType: event.window_type,
					status: event.status,
					priority: event.priority,
					startIso: event.start,
					endIso: event.end,
					startMinute: 0,
					endMinute: MINUTES_PER_DAY,
				});
			}
		}
		return [...seen.values()];
	});

	// S5-a：打开即滚到当前时刻（或工作时段起点），取较早者
	createEffect(() => {
		// 依赖粒度与当前日期：换视图/翻页后要重新定位
		m.granularity();
		m.currentDate();
		const scroller = scrollerRef;
		if (!scroller) {
			return;
		}
		const target = Math.max(0, Math.min(nowMinute(), WORKDAY_START_MINUTE));
		scroller.scrollTop = minutesToPixels(target);
	});

	const days = () => m.visibleDays();

	return (
		<div class={styles.axisView}>
			{/* 表头：日期 + 星期（周视图 7 列，日视图 1 列） */}
			<div
				class={styles.axisHeader}
				style={{
					"grid-template-columns": `repeat(${Math.max(1, days().length)}, 1fr)`,
				}}
			>
				<For each={days()}>
					{(day) => (
						<div
							class={styles.axisHeaderCell}
							classList={{ [styles.today]: isSameDay(day, today) }}
						>
							<span class={styles.headerDay}>{day.getDate()}</span>
							<span class={styles.headerWeekday}>
								{m.weekdayLabels()[(day.getDay() - m.firstDay() + 7) % 7]}
							</span>
						</div>
					)}
				</For>
			</div>

			{/* S5-3：全天行（跨日事件）—— 只在真有跨日段时才占高度。
			    用 ul 而不是 div：普通 div 没 role，aria-label 会被读屏忽略 */}
			<Show when={allDayBlocks().length > 0}>
				<ul class={styles.allDayRow} aria-label="跨日事件">
					<For each={allDayBlocks()}>
						{(block) => (
							<li class={styles.allDayChip} title={block.title}>
								{block.title}
							</li>
						)}
					</For>
				</ul>
			</Show>

			{/* biome-ignore lint/a11y/useSemanticElements: 时间轴不是数据表 —— 事件块是绝对定位叠在小时线上的，用 table 表达反而不成立（读屏的心智模型由下面每列的 gridcell 与事件块按钮承担） */}
			<div
				class={styles.axisScroller}
				ref={scrollerRef}
				role="grid"
				aria-label="时间轴"
			>
				{/* 刻度列（小时标签）在左，事件列在右 */}
				<div class={styles.hourGutter} aria-hidden="true">
					<For each={hourMarks()}>
						{(mark) => (
							<span class={styles.hourLabel} style={{ top: `${mark.top}px` }}>
								{mark.label}
							</span>
						)}
					</For>
				</div>

				<div
					class={styles.dayColumns}
					style={{
						"grid-template-columns": `repeat(${Math.max(1, days().length)}, 1fr)`,
						// 必须显式给高度：小时线与事件块都是绝对定位的，
						// 它们撑不出父容器的高度（没有它滚动区会塌成 0）
						height: `${DAY_HEIGHT}px`,
					}}
				>
					<For each={days()}>
						{(day, index) => (
							<AxisDayColumn
								dayIndex={index()}
								today={isSameDay(day, today)}
								segments={blocksForDay(day)}
								nowMinute={nowMinute()}
								onOpenTask={(taskId) => props.onOpenTask?.(taskId)}
							/>
						)}
					</For>
				</div>
			</div>
		</div>
	);
}
