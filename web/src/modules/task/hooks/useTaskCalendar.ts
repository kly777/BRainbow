import { notifyError, useListResource } from "@shared/utils";
import { createMemo, createSignal } from "solid-js";
import { type CalendarEvent, getCalendarEventsE } from "../api.ts";
import {
	type CalendarDensity,
	columnWeekday,
	type DaySegment,
	DENSITY_COLLAPSED_COUNT,
	dayKey,
	type GridCell,
	getCalendarDensity,
	getWeekStartSetting,
	localeWeekendDays,
	monthGrid,
	orderedWeekdayLabels,
	resolveFirstDay,
	segmentEventsByDay,
	setCalendarDensity,
	setWeekStartSetting,
	startOfDay,
	startOfWeek,
	type Weekday,
} from "../lib/calendar.ts";

/** 视图粒度。当前粒度是**信息**不是命令 —— 用户必须随时知道自己在看哪一层，
 *  所以它常驻在日历那一行（06-日历视图 §2） */
export type CalendarGranularity = "month" | "week" | "day";

export interface TaskCalendarApi {
	currentDate: () => Date;
	monthTitle: () => string;
	/** 视图粒度：月网格 / 周时间轴 / 日时间轴 */
	granularity: () => CalendarGranularity;
	setGranularity: (value: CalendarGranularity) => void;
	/** 当前粒度下要画的那些天（周视图 7 天、日视图 1 天） */
	visibleDays: () => readonly Date[];
	/** 重新取数（落位之后刷新日历） */
	reload: () => void;
	/** 月网格（含补位格）；周/日视图下为空数组 */
	grid: () => readonly GridCell[];
	/** 表头标签，按当前起始日取值 */
	weekdayLabels: () => readonly string[];
	weekdayShortLabels: () => readonly string[];
	/** 网格某列是不是周末（用于分隔线与弱化） */
	isWeekendCol: (col: number) => boolean;
	/** 周起始日（设置项存的是 `Weekday`，不是 CLDR 编号） */
	firstDay: () => Weekday;
	/** 用户**显式选过**的起始日；null = 跟随区域设置。设置条靠它区分这两种状态 */
	weekStartSetting: () => Weekday | null;
	setFirstDay: (value: Weekday | null) => void;
	/** 密度档与"每格显示几条" */
	density: () => CalendarDensity;
	collapsedCount: () => number;
	setDensity: (value: CalendarDensity) => void;
	/** 某天的段（折叠前的原始列表） */
	segmentsFor: (key: string) => readonly DaySegment[];
	/** 某天的事件（徽标判定用） */
	eventsFor: (key: string) => readonly CalendarEvent[];
	changeMonth: (delta: number) => void;
	/** 回到今天（S4-7：现状只有 ±1 翻月，翻到远处就回不来了） */
	goToToday: () => void;
	isToday: (date: Date | null) => boolean;
	today: () => Date;
}

export function useTaskCalendar(weekParam?: () => string | undefined) {
	const [currentDate, setCurrentDate] = createSignal<Date>(new Date());
	const [granularity, setGranularity] =
		createSignal<CalendarGranularity>("month");
	const [density, setDensitySignal] = createSignal<CalendarDensity>(
		getCalendarDensity(),
	);
	// 设置项变了要重新求值（`firstDay` 是 memo，依赖这里）
	const [weekStartOverride, setWeekStartOverride] =
		createSignal<Weekday | null>(getWeekStartSetting());

	// `resolveFirstDay` 内部读 localStorage（不是响应式的），所以这里显式引用
	// `weekStartOverride` 让"用户改了设置"能触发重算
	const firstDay = createMemo<Weekday>(() => {
		void weekStartOverride();
		return resolveFirstDay(weekParam?.());
	});
	const weekendDays = createMemo(() => new Set(localeWeekendDays()));

	/** 当前粒度下要画的那些天（周 7 天、日 1 天；月视图用不到这个） */
	const visibleDays = createMemo<readonly Date[]>(() => {
		const date = currentDate();
		if (granularity() === "day") {
			return [startOfDay(date)];
		}
		if (granularity() === "week") {
			const start = startOfWeek(date, firstDay());
			return Array.from({ length: 7 }, (_, i) => {
				const day = new Date(start);
				day.setDate(day.getDate() + i);
				return day;
			});
		}
		return [];
	});

	const monthRange = createMemo(() => {
		const d = currentDate();
		// 周/日视图按那一段取；上界给**区间末日 +1 天的零点**：后端是
		// `start_time < end AND end_time > start` 的半开重叠查询，所以跨到区间外
		// 头一天的时段（以及末日当天结束的）都在范围内。
		if (granularity() === "month") {
			const y = d.getFullYear();
			const m = d.getMonth();
			return {
				start: new Date(y, m, 1).toISOString(),
				end: new Date(y, m + 1, 1).toISOString(),
			};
		}
		const days = visibleDays();
		const first = days[0] ?? startOfDay(d);
		const last = days[days.length - 1] ?? startOfDay(d);
		const end = new Date(last);
		end.setDate(end.getDate() + 1);
		return { start: first.toISOString(), end: end.toISOString() };
	});

	// 月份区间即请求键；端点给数组，交原语归一（错误经 onError 提示，
	// 日历没有错误态槽位，只在这里 toast 一次）
	const list = useListResource<{ start: string; end: string }, CalendarEvent>({
		key: monthRange,
		fetcher: (range) => getCalendarEventsE(range.start, range.end),
		onError: () => notifyError("获取日历事件失败"),
	});

	/** 重新取数（拖拽落位之后刷新日历用） */
	const reload = () => void list.refetch();

	/** 跨日切分后按天归组（同一份结果喂给事件条与徽标判定） */
	const segmentsByDay = createMemo(() =>
		segmentEventsByDay(list.items() ?? []),
	);

	/** 每天的原始事件（徽标判定要的是"这天有哪些事件"，不是切分段） */
	const eventsByDay = createMemo(() => {
		const map = new Map<string, CalendarEvent[]>();
		for (const segments of segmentsByDay().values()) {
			const key = segments[0]?.dayKey;
			if (key === undefined) continue;
			const unique = new Map<number, CalendarEvent>();
			for (const segment of segments) {
				unique.set(segment.event.task_id, segment.event);
			}
			map.set(key, [...unique.values()]);
		}
		return map;
	});

	const changeMonth = (delta: number) => {
		// 落到 1 号再设月：保留"31 号"的话，2 月会被 setMonth 滚成 3 月
		const date = currentDate();
		setCurrentDate(new Date(date.getFullYear(), date.getMonth() + delta, 1));
	};

	const goToToday = () => setCurrentDate(new Date());

	const setDensity = (value: CalendarDensity) => {
		setCalendarDensity(value);
		setDensitySignal(value);
	};

	const setFirstDay = (value: Weekday | null) => {
		setWeekStartSetting(value);
		setWeekStartOverride(value);
	};

	const today = () => new Date();

	return {
		currentDate,
		monthTitle: () => {
			const date = currentDate();
			return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
		},
		grid: () => {
			const date = currentDate();
			if (granularity() !== "month") {
				return [];
			}
			return monthGrid(date.getFullYear(), date.getMonth(), firstDay());
		},
		granularity,
		setGranularity,
		visibleDays,
		reload,
		weekdayLabels: () => orderedWeekdayLabels(firstDay()),
		weekdayShortLabels: () => orderedWeekdayLabels(firstDay(), false),
		isWeekendCol: (col: number) =>
			weekendDays().has(columnWeekday(firstDay(), col)),
		firstDay,
		weekStartSetting: weekStartOverride,
		setFirstDay,
		density,
		collapsedCount: () => DENSITY_COLLAPSED_COUNT[density()],
		setDensity,
		segmentsFor: (key: string) => segmentsByDay().get(key) ?? [],
		eventsFor: (key: string) => eventsByDay().get(key) ?? [],
		changeMonth,
		goToToday,
		today,
		isToday: (date: Date | null) => {
			if (!date) return false;
			const now = today();
			return dayKey(date) === dayKey(now);
		},
	};
}
