// ── 日历的纯计算与用户设置 ──
//
// 规则都在这里，组件只做渲染 —— 与 `task-group.ts` / `capture.ts` 同一个理由：
// 留在组件里只能靠肉眼验证（跨日切分、周起始日偏移这类边界很容易"看起来对"）。
//
// ## 周起始日：locale 默认 + 用户设置
//
// CLDR 的 `firstDay` 在 CN 是**周一**、在 US/JP/KR/TW 是**周日** —— 写死周日对中文用户
// 是错的。但只按 locale 推导还不够：Google 日历把它做成了用户设置项，我们照做（设置优先）。
//
// 优先级：URL 深链接 `?week=mon` > 用户设置 > locale 默认 > 回落周一。
//
// ## 跨日切分：半开区间
//
// `end` **恰好落在午夜 → 那天不画**（那属于次日）。这与 C002 的"边界相接不算重叠"
// 是同一个约定，全项目统一，不是这里特有的怪癖。

import type { CalendarEvent } from "../api-types.ts";

// ── 周起始日 / 周末 ──

/** JS 的 getDay 约定：0 = 周日 … 6 = 周六 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 取不到 locale 信息时的回落：周一（CLDR 在 CN 的口径，也是最常见的"周一开始"） */
export const DEFAULT_FIRST_DAY: Weekday = 1;

const FULL_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const SHORT_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

/** CLDR 的 firstDay（1 = 周一 … 7 = 周日）→ JS 的 getDay 编号 */
function fromCldrDay(cldr: number): Weekday {
	return (cldr % 7) as Weekday;
}

interface WeekInfo {
	firstDay: number;
	weekend?: number[];
}

function weekInfoOf(locale: string): WeekInfo | null {
	try {
		const info = (
			new Intl.Locale(locale) as Intl.Locale & {
				getWeekInfo?: () => WeekInfo;
			}
		).getWeekInfo?.();
		return info?.firstDay ? info : null;
	} catch {
		// 非法 locale 串或老引擎没有 getWeekInfo —— 都走回落
		return null;
	}
}

/** 按 locale 推导周起始日（取不到回落周一） */
export function localeFirstDay(locale?: string): Weekday {
	const info = weekInfoOf(locale ?? navigator.language);
	return info ? fromCldrDay(info.firstDay) : DEFAULT_FIRST_DAY;
}

/** 按 locale 推导周末（缺省周六周日） */
export function localeWeekendDays(locale?: string): readonly Weekday[] {
	const info = weekInfoOf(locale ?? navigator.language);
	if (info?.weekend?.length) {
		return info.weekend.map(fromCldrDay);
	}
	return [0, 6];
}

/** 7 个表头标签，按起始日偏移后取（桌面全称） */
export function orderedWeekdayLabels(
	firstDay: Weekday,
	full = true,
): readonly string[] {
	const labels = full ? FULL_LABELS : SHORT_LABELS;
	return Array.from({ length: 7 }, (_, i) => labels[(firstDay + i) % 7]);
}

/** 网格第 col 列（0 起，按起始日）对应的 getDay 编号 */
export function columnWeekday(firstDay: Weekday, col: number): Weekday {
	return ((firstDay + col) % 7) as Weekday;
}

/** `?week=mon` 这类深链接 → 起始日（同时是 localStorage 里存的那份值） */
const WEEK_PARAM: Record<string, Weekday> = {
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6,
};

/** 起始日 → `WEEK_PARAM` 的键（存的时候用，读的时候同一套，两边不能各写一份） */
const WEEK_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function parseWeekParam(
	value: string | null | undefined,
): Weekday | null {
	if (!value) {
		return null;
	}
	return WEEK_PARAM[value.trim().toLowerCase()] ?? null;
}

// ── 用户设置（localStorage，形状与 theme.ts 的字号档位一致）──

const WEEK_START_KEY = "brainbow_calendar_week_start";
const DENSITY_KEY = "brainbow_calendar_density";

/** 密度档：只控制"每格显示几条"，**不控制每条多高**（MD3：压缩会损害可点击目标） */
export type CalendarDensity = "compact" | "standard";

export const DENSITY_COLLAPSED_COUNT: Record<CalendarDensity, number> = {
	compact: 3,
	standard: 5,
};

/** 用户显式选过的周起始日（没选过 = null，即"跟 locale 走"） */
export function getWeekStartSetting(): Weekday | null {
	const saved = localStorage.getItem(WEEK_START_KEY);
	if (saved === null) {
		return null;
	}
	const parsed = WEEK_PARAM[saved];
	return parsed === undefined ? null : parsed;
}

export function setWeekStartSetting(value: Weekday | null): void {
	if (value === null) {
		localStorage.removeItem(WEEK_START_KEY);
		return;
	}
	localStorage.setItem(WEEK_START_KEY, WEEK_KEYS[value]);
}

export function getCalendarDensity(): CalendarDensity {
	return localStorage.getItem(DENSITY_KEY) === "standard"
		? "standard"
		: "compact";
}

export function setCalendarDensity(value: CalendarDensity): void {
	localStorage.setItem(DENSITY_KEY, value);
}

/** 三层合成的最终起始日：深链接 > 设置 > locale */
export function resolveFirstDay(param?: string | null): Weekday {
	return parseWeekParam(param) ?? getWeekStartSetting() ?? localeFirstDay();
}

// ── 日期键（一律补零）──

/** `2026-10-03` —— 月份与日都补零，与其他按日期拼 key 的地方同形 */
export function dayKey(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

/** 网格补位格在 CSS / 测试里的身份（用日期本身当 key 会让 0 号格与别的撞） */
export function paddingKey(index: number): string {
	return `pad-${index}`;
}

export function isPaddingKey(key: string): boolean {
	return key.startsWith("pad-");
}

/** 当地零点 */
export function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isSameDay(a: Date | null, b: Date): boolean {
	return (
		a !== null &&
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/** 该周的周一（按传入的起始日） */
export function startOfWeek(date: Date, firstDay: Weekday): Date {
	const diff = (date.getDay() - firstDay + 7) % 7;
	const start = startOfDay(date);
	start.setDate(start.getDate() - diff);
	return start;
}

// ── 月网格 ──

export type GridCell =
	| { date: Date; key: string }
	| { date: null; key: string };

/**
 * 一个月的网格（补位格 `date: null`）。
 *
 * 补位格**可聚焦但不可操作**（APG 的要求），所以它们进数组而不是被裁掉 ——
 * 焦点顺序要与视觉顺序一致，少一格就会让 Tab 跳出去。
 */
export function monthGrid(
	year: number,
	month: number,
	firstDay: Weekday,
): GridCell[] {
	const cells: GridCell[] = [];
	const leading = (new Date(year, month, 1).getDay() - firstDay + 7) % 7;
	for (let i = 0; i < leading; i++) {
		cells.push({ date: null, key: paddingKey(i) });
	}
	const daysInMonth = new Date(year, month + 1, 0).getDate();
	for (let day = 1; day <= daysInMonth; day++) {
		const date = new Date(year, month, day);
		cells.push({ date, key: dayKey(date) });
	}
	while (cells.length % 7 !== 0) {
		cells.push({ date: null, key: paddingKey(cells.length) });
	}
	return cells;
}

// ── 跨日切分 ──

/** 一天里的一段（半开区间 `[dayStart, segEnd)`） */
export interface DaySegment {
	event: CalendarEvent;
	/** 这段落在哪一天（补零日期键） */
	dayKey: string;
	/** 当天的起始钟点（分钟，从 0 起）—— 事件条上的时间前缀 */
	startMinute: number;
	/** 当天的结束钟点；延续到次日则封顶 1440 */
	endMinute: number;
	/** 从前一天延续过来（左侧断口） */
	continuesFromPrev: boolean;
	/** 延续到后一天（右侧断口） */
	continuesToNext: boolean;
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * 把一条事件切成一串"每天一段"。
 *
 * 半开区间：`end` 恰好落在午夜 → 那天不画（属于次日）。
 * 零时长（`end <= start`）不报错，画成当天的一个零长段 —— 宁可画错一格，
 * 也不让一条事件凭空消失。
 */
export function splitEventByDay(event: CalendarEvent): DaySegment[] {
	const start = new Date(event.start);
	const end = new Date(event.end);
	if (Number.isNaN(start.getTime())) {
		return [];
	}
	// 末段的那天：end 恰好是零点时归次日 —— 减 1ms 让循环停在正确的天
	const lastDayStart =
		Number.isNaN(end.getTime()) || end <= start
			? startOfDay(start)
			: startOfDay(new Date(end.getTime() - 1));

	const segments: DaySegment[] = [];
	const cursor = startOfDay(start);
	// 防御性上限：即使遇到坏数据（end 远在天边）也不会把循环跑成天量级
	for (let guard = 0; guard < 400; guard++) {
		const dayEnd = new Date(cursor);
		dayEnd.setDate(dayEnd.getDate() + 1);

		const segStart = start > cursor ? start : cursor;
		const segEnd = end > dayEnd ? dayEnd : end;
		segments.push({
			event,
			dayKey: dayKey(cursor),
			startMinute: Math.round((segStart.getTime() - cursor.getTime()) / 60_000),
			endMinute: Math.round((segEnd.getTime() - cursor.getTime()) / 60_000),
			continuesFromPrev: start < cursor,
			continuesToNext: end > dayEnd,
		});

		if (cursor.getTime() >= lastDayStart.getTime()) {
			break;
		}
		cursor.setDate(cursor.getDate() + 1);
	}
	return segments;
}

/** 把一组事件按天切开：`dayKey → 该天的段`（组内按开始时间排） */
export function segmentEventsByDay(
	events: readonly CalendarEvent[],
): Map<string, DaySegment[]> {
	const map = new Map<string, DaySegment[]>();
	for (const event of events) {
		for (const segment of splitEventByDay(event)) {
			const bucket = map.get(segment.dayKey);
			if (bucket) {
				bucket.push(segment);
			} else {
				map.set(segment.dayKey, [segment]);
			}
		}
	}
	for (const bucket of map.values()) {
		bucket.sort(
			(a, b) =>
				a.startMinute - b.startMinute ||
				a.event.start.localeCompare(b.event.start),
		);
	}
	return map;
}

/** 这天有没有"逾期未完成"（日期数字上的 ⚠ 徽标靠它） */
export function hasOverdue(events: readonly CalendarEvent[]): boolean {
	const now = Date.now();
	return events.some((event) => {
		if (!event.due_at) return false;
		if (event.status === "completed" || event.status === "archived")
			return false;
		const due = new Date(event.due_at).getTime();
		return Number.isFinite(due) && due < now;
	});
}

/** 这天有没有 feasible（"我大概有空"这种元信息，画空心方块存在性徽标） */
export function hasFeasible(events: readonly CalendarEvent[]): boolean {
	return events.some((event) => event.window_type === "feasible");
}

/** 事件条的时间前缀 `09:00`（跨日段用当天的真实起点） */
export function formatSegmentTime(segment: DaySegment): string {
	const hour = Math.floor(segment.startMinute / 60) % 24;
	const minute = segment.startMinute % 60;
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** 时长文案（tooltip 用）：`1 小时 30 分` / `45 分钟` */
export function formatDuration(minutes: number): string {
	if (minutes < 60) {
		return `${minutes} 分钟`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

export { MINUTES_PER_DAY };
