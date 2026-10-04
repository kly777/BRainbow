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
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	For,
	Show,
} from "solid-js";
import type { CalendarEvent } from "../api-types.ts";
import type { TaskCalendarApi } from "../hooks/useTaskCalendar.ts";
import { dayKey, isSameDay, MINUTES_PER_DAY } from "../lib/calendar.ts";
import {
	type AxisBlock,
	blockHeight,
	blockSize,
	dragOffsetToMinute,
	hourMarks,
	type LaidOutBlock,
	layoutOverlaps,
	minutesToPixels,
	projectToDay,
} from "../lib/calendarAxis.ts";
import {
	blocksOfDay,
	cancelDrag,
	type DragState,
	formatTimeInput,
	INITIAL_DRAG,
	nudgeMinutes,
	onPointerMove,
	onPointerUp,
	parseTimeInput,
	previewDrop,
} from "../lib/dragSchedule.ts";
import styles from "./CalendarTimeGrid.module.css";

/** 整天的轴高度（1440 分钟 × 每分钟像素） */
const DAY_HEIGHT = minutesToPixels(MINUTES_PER_DAY);

/** S5-a：打开就滚到当前时刻（或工作时段起点 09:00），取较早者 */
const WORKDAY_START_MINUTE = 9 * 60;

/** 点空白新建时给的默认时长（30 分钟：一格吸附、够放下一个会） */
const DEFAULT_NEW_WINDOW_MINUTES = 30;

/** 落位请求：块 + 移动前的位置（撤销要用） */
export interface ScheduleMove {
	windowId: number | null;
	dayKey: string;
	startMinute: number;
	endMinute: number;
	/** 移动前的起止（ISO）；新建时为 null */
	previous: { start: string; end: string } | null;
}

interface AxisDayColumnProps {
	day: Date;
	dayIndex: number;
	today: boolean;
	segments: readonly AxisBlock[];
	nowMinute: number | null;
	onOpenTask: (taskId: number) => void;
	/** roving tabindex：当前吃焦点的块（null = 还没进过这个网格） */
	focusedId: () => number | null;
	setFocusedId: (id: number | null) => void;
	/** `←/→` 在事件间移动焦点 */
	moveFocus: (delta: -1 | 1) => void;
	/** 落位请求（拖完 / 键盘改完都走它）；`windowId` 为 null 表示"新建一条" */
	onSchedule: (move: ScheduleMove) => void;
	/** 拖拽状态与拖影预览在这一层维护（每列各自一份） */
	drag: DragState;
	setDrag: (state: DragState) => void;
}

const AxisDayColumn: Component<AxisDayColumnProps> = (props) => {
	// 重叠布局：列数 = 最大同时重叠数（贪心的最优性保证）
	const laid = createMemo(() => layoutOverlaps(props.segments));
	const [originY, setOriginY] = createSignal<number | null>(null);
	const [draggingId, setDraggingId] = createSignal<number | null>(null);

	/** 落点预览：拖拽中才画，且**只对合法落点画**（HIG：非法目标不给高亮） */
	const preview = createMemo(() => {
		if (props.drag.phase !== "dragging" || draggingId() === null) {
			return null;
		}
		return previewDrop(
			props.drag.targetMinute,
			props.drag.durationMinutes,
			blocksOfDay(props.segments),
		);
	});

	const localY = (e: { clientY: number; currentTarget: HTMLElement }) => {
		const rect = e.currentTarget.getBoundingClientRect();
		return e.clientY - rect.top;
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 点空白新建的落点是一大片没有语义角色的背景（它是「轴上的空白」，不是控件）；键盘用户走事件块的 ↑/↓ 与 Enter（WCAG 2.5.7 的等价路径），这条只是鼠标的便捷入口
		// biome-ignore lint/a11y/useKeyWithClickEvents: 同上 —— 键盘路径在事件块上（它们才是可聚焦的控件），背景本身不进 Tab 序
		<div
			class={styles.dayColumn}
			classList={{
				[styles.today]: props.today,
				[styles.weekendCol]: props.dayIndex === 0 || props.dayIndex === 6,
			}}
			/* 点空白 → 在那儿新建一条（S5-8）。
			   判定用「位移没超阈值」而不是「点在块上」：后者在块之间的缝隙上会误判，
			   而且块自己 stopPropagation 之后这里收不到事件，两条路都不可靠。
			   拖拽刚结束时这次 click 也会跟着来 —— 所以还要看当前不在拖拽中 */
			onClick={(e) => {
				if (originY() !== null || props.drag.phase === "dragging") {
					return;
				}
				if (
					e.target !== e.currentTarget &&
					!(e.target as HTMLElement).classList.contains(styles.hourLine)
				) {
					return; // 点在块或刻度线上，不新建
				}
				const start = dragOffsetToMinute(localY(e));
				props.onSchedule({
					windowId: null,
					dayKey: dayKey(props.day),
					startMinute: start,
					endMinute: start + DEFAULT_NEW_WINDOW_MINUTES,
					previous: null,
				});
			}}
			onPointerMove={(e) => {
				if (originY() === null) {
					return;
				}
				props.setDrag(
					onPointerMove(
						props.drag,
						localY(e) - (originY() as number),
						dragOffsetToMinute,
					),
				);
			}}
			onPointerUp={() => {
				setOriginY(null);
				const dropped = onPointerUp(props.drag);
				const draggedId = draggingId();
				setDraggingId(null);
				// 位移不足 → null → 判定为点击，不落位（S5-i）
				if (!dropped || draggedId === null) {
					return;
				}
				const p = previewDrop(
					dropped.targetMinute,
					dropped.durationMinutes,
					blocksOfDay(props.segments),
				);
				if (p.legal) {
					// 撤销要回到**这块刚才在哪儿**（拖拽起点的那个块），
					// 而不是服务端此刻的样子
					const from = props.segments.find(
						(block) => block.taskId === draggedId,
					);
					props.onSchedule({
						windowId: draggedId,
						dayKey: dayKey(props.day),
						startMinute: p.startMinute,
						endMinute: p.endMinute,
						previous: from ? { start: from.startIso, end: from.endIso } : null,
					});
				}
				props.setDrag(cancelDrag());
			}}
			onPointerCancel={() => {
				setOriginY(null);
				setDraggingId(null);
				props.setDrag(cancelDrag());
			}}
			onPointerLeave={() => {
				if (originY() === null) {
					return;
				}
				setOriginY(null);
				setDraggingId(null);
				props.setDrag(cancelDrag());
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
				{(block) => (
					<EventBlock
						block={block}
						dragging={draggingId() === block.taskId}
						isFocused={props.focusedId() === block.id}
						onFocus={() => props.setFocusedId(block.id)}
						onMoveFocus={(delta) => props.moveFocus(delta)}
						onGrab={(y) => {
							setOriginY(y);
							setDraggingId(block.taskId);
							props.setDrag({
								...INITIAL_DRAG,
								phase: "dragging",
								durationMinutes: block.endMinute - block.startMinute,
							});
						}}
						onNudge={(delta) => {
							// S5-f 的键盘等价路径：↑/↓ 直接上移下移一格 15 分钟
							const next = nudgeMinutes(
								block.startMinute,
								delta,
								undefined,
								block.endMinute - block.startMinute,
							);
							props.onSchedule({
								windowId: block.id,
								dayKey: dayKey(props.day),
								startMinute: next,
								endMinute: next + (block.endMinute - block.startMinute),
								previous: { start: block.startIso, end: block.endIso },
							});
						}}
						onRetime={(text) => {
							const parsed = parseTimeInput(text);
							if (parsed === null) {
								return;
							}
							const span = block.endMinute - block.startMinute;
							props.onSchedule({
								windowId: block.id,
								dayKey: dayKey(props.day),
								startMinute: parsed,
								endMinute: parsed + span,
								previous: { start: block.startIso, end: block.endIso },
							});
						}}
						onOpenTask={props.onOpenTask}
					/>
				)}
			</For>

			{/* 落位预览（拖影）：半透明 + 只在合法时出现 */}
			<Show when={preview()}>
				{(p) => (
					<div
						class={styles.dropPreview}
						classList={{ [styles.dropPreviewIllegal]: !p().legal }}
						style={{
							top: `${minutesToPixels(p().startMinute)}px`,
							height: `${minutesToPixels(p().endMinute - p().startMinute)}px`,
						}}
						aria-hidden="true"
					/>
				)}
			</Show>

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

/** 一个事件块：高度 ∝ 时长，宽度按重叠列数分；可拖、可键盘改时间 */
const EventBlock: Component<{
	block: LaidOutBlock;
	/** 正在被拖（半透明，让用户看见自己拖的是哪一块） */
	dragging: boolean;
	/** roving tabindex：只有它 tabindex=0，整个网格才占一个 Tab 停靠点 */
	isFocused: boolean;
	onFocus: () => void;
	/** `←/→` 在事件间移动焦点 */
	onMoveFocus: (delta: -1 | 1) => void;
	/** 开始拖（记录起点 Y；位移判定在 lib/dragSchedule） */
	onGrab: (clientY: number) => void;
	/** 键盘上移下移一格 */
	onNudge: (delta: -1 | 1) => void;
	/** 键盘改时间（`Enter` 进的 `HH:MM` 输入） */
	onRetime: (text: string) => void;
	onOpenTask: (taskId: number) => void;
}> = (props) => {
	const height = () => blockHeight(props.block);
	const size = () => blockSize(props.block.endMinute - props.block.startMinute);
	const clock = (m: number) =>
		`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
	// `Enter` 进改时间模式；再按 `Enter` 或 `Esc` 退出
	const [editingTime, setEditingTime] = createSignal(false);

	return (
		<Tooltip
			label={`${props.block.title} · ${clock(props.block.startMinute)}–${clock(props.block.endMinute)}`}
		>
			{/*
			 * 用带 tabindex 的 div + role=button，而不是真 <button>：
			 * 块内会嵌一个改时间的 <input>（键盘等价路径），而 HTML 禁止
			 * <button> 含交互内容。两条 lint 抑制的理由都是这一条。
			 */}
			{/* biome-ignore lint/a11y/useFocusableInteractive: div 带 tabindex={0}，可聚焦 */}
			{/* biome-ignore lint/a11y/useSemanticElements: 用 div + role=button 而不是真 <button> —— 块内要嵌改时间的 <input>，HTML 禁止 <button> 含交互内容 */}
			<div
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
					[styles.dragging]: props.dragging,
				}}
				style={{
					top: `${minutesToPixels(props.block.startMinute)}px`,
					height: `${height()}px`,
					left: `${(props.block.column / props.block.columns) * 100}%`,
					width: `${(1 / props.block.columns) * 100}%`,
				}}
				role="button"
				tabindex={props.isFocused ? 0 : -1}
				data-block-id={props.block.id}
				aria-label={`${props.block.title} ${clock(props.block.startMinute)} 到 ${clock(props.block.endMinute)}`}
				onFocus={props.onFocus}
				onClick={() => {
					// 位移不足时 pointerup 会把它判回点击 —— 这里才打开详情（S5-i）
					if (!props.dragging) {
						props.onOpenTask(props.block.taskId);
					}
				}}
				onPointerDown={(e) => {
					// 只响应主键：右键/中键留给浏览器
					if (e.button !== 0 || editingTime()) {
						return;
					}
					props.onGrab(e.clientY);
				}}
				onKeyDown={(e) => {
					if (editingTime()) {
						return; // 输入框自己的按键由它处理
					}
					// ↑/↓ 直接上移下移一格（键盘等价路径之一，WCAG 2.5.7）
					if (e.key === "ArrowUp" || e.key === "ArrowDown") {
						e.preventDefault();
						props.onNudge(e.key === "ArrowUp" ? -1 : 1);
					}
					// ←/→ 在事件间移动焦点（APG §6.4 的"焦点层"）——
					//  ↑↓ 让位给了"改时间"，这里补上事件间的移动，两条路都在
					if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
						e.preventDefault();
						props.onMoveFocus(e.key === "ArrowLeft" ? -1 : 1);
					}
					// Enter 进改时间（键盘等价路径之二）
					if (e.key === "Enter") {
						e.preventDefault();
						setEditingTime(true);
					}
				}}
			>
				<Show
					when={editingTime()}
					fallback={
						<>
							<Show when={size() !== "tiny"}>
								<span class={styles.blockTime}>
									{clock(props.block.startMinute)}
								</span>
							</Show>
							<span class={styles.blockTitle}>{props.block.title}</span>
						</>
					}
				>
					<input
						class={styles.retimeInput}
						value={formatTimeInput(props.block.startMinute)}
						autofocus
						aria-label={`改「${props.block.title}」的开始时间`}
						onChange={(e) => props.onRetime(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === "Escape") {
								e.stopPropagation();
								setEditingTime(false);
							}
						}}
					/>
				</Show>
			</div>
		</Tooltip>
	);
};

export interface CalendarTimeGridProps {
	calendar: TaskCalendarApi;
	onOpenTask?: (taskId: number) => void;
	/**
	 * 落位（拖完 / 键盘改完都走它）。`windowId` 为 null 表示"在那儿新建一条"。
	 * 服务端是最终裁决者（C001/C002），这里只把用户的意图传上去。
	 */
	onSchedule?: (move: ScheduleMove) => void;
}

export default function CalendarTimeGrid(props: CalendarTimeGridProps) {
	const m = props.calendar;
	let scrollerRef: HTMLDivElement | undefined;
	// 每列各自一份拖拽状态（一次只拖一块）
	const [drag, setDrag] = createSignal<DragState>(INITIAL_DRAG);

	/**
	 * roving tabindex：整个时间轴只占**一个** Tab 停靠点，方向键在块之间移动
	 * （APG Grid）。42 个块按 42 次 Tab 是不可用的。
	 */
	const [focusedId, setFocusedId] = createSignal<number | null>(null);

	/** `←/→` 在事件间移动焦点（APG §6.4 的"焦点层"）。
	 *  `↑/↓` 留给"改时间"（S5-f 明确要求的拖拽键盘等价）—— 文档里这两处对 ↑↓
	 *  的说法不一致，这里按"硬要求优先"取舍：它保证键盘用户能改时间，而 ←→ 同样
	 *  能完成事件间的移动，两条路都在。 */
	const moveFocus = (blocks: readonly AxisBlock[], delta: -1 | 1) => {
		if (blocks.length === 0) {
			return;
		}
		const sorted = [...blocks].sort((a, b) => a.startMinute - b.startMinute);
		const current = sorted.findIndex((b) => b.id === focusedId());
		const next =
			current === -1
				? delta > 0
					? 0
					: sorted.length - 1
				: Math.min(Math.max(current + delta, 0), sorted.length - 1);
		setFocusedId(sorted[next].id);
		// 焦点真正移过去（否则 roving 只改了 tabindex，键盘焦点还留在原地）
		const node = document.querySelector<HTMLElement>(
			`[data-block-id="${sorted[next].id}"]`,
		);
		node?.focus();
	};

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
				// `id` 是**时间窗**的 id（落位要 PATCH 这条记录），不是任务 id
				id: segment.event.window_id,
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
								day={day}
								dayIndex={index()}
								today={isSameDay(day, today)}
								segments={blocksForDay(day)}
								nowMinute={nowMinute()}
								onOpenTask={(taskId) => props.onOpenTask?.(taskId)}
								focusedId={focusedId}
								setFocusedId={setFocusedId}
								moveFocus={(delta) => moveFocus(blocksForDay(day), delta)}
								onSchedule={(move) => props.onSchedule?.(move)}
								drag={drag()}
								setDrag={setDrag}
							/>
						)}
					</For>
				</div>
			</div>
		</div>
	);
}
