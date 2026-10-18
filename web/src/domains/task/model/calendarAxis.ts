// ── 时间轴的纯计算：像素 ↔ 时刻、重叠布局 ──
//
// 与 `lib/calendar.ts` 同一层：网格只做渲染，规则在这里，能被直接断言。
//
// ## 重叠布局用贪心区间图着色
//
// 按左端点排序，每段放进**第一个可复用的列**（CLRS 第 16 节）。已证明是最优且线性，
// 不是"够用的近似"—— 列数恰好等于最大同时重叠数（验收 S5-c）。
//
// 为什么不能"两两比较分层"：那是 O(n²) 且层数会虚高（同一条链上的三段互不重叠
// 却被算成三层）。

/** 一段在时间轴上的几何：起止是**距当天零点的分钟数** */
export interface AxisBlock {
	id: number;
	/** 距零点分钟（0 = 00:00） */
	startMinute: number;
	/** 距零点分钟；跨天时封顶 1440 */
	endMinute: number;
	/** 原始 ISO（tooltip 与写回用） */
	startIso: string;
	endIso: string;
	title: string;
	taskId: number;
	windowType: string;
	status: string;
	priority: string | null;
}

/** 布局结果：块 + 它占的列号 + 该天总列数 */
export interface LaidOutBlock extends AxisBlock {
	/** 第几列（0 起） */
	column: number;
	/** 这天一共几列 */
	columns: number;
}

// ── 像素 ↔ 时刻 ──

/** 一天的分钟数 */
export const MINUTES_PER_DAY = 24 * 60;

/** 拖拽与改时长的吸附粒度（设计文档 S5-6） */
export const SNAP_MINUTES = 15;

/** 事件块的最小高度（WCAG 2.5.8 的触摸目标下限；日期格是例外，事件块不是） */
export const MIN_BLOCK_HEIGHT = 24;

/** 短于此值的事件：块太矮读不出标题，所以给一个下限并在视觉上标注"短" */
export const SHORT_EVENT_MINUTES = 30;

/** 一小时多少像素 —— 唯一可调的视觉常量，其余都从这里推 */
export const PIXELS_PER_HOUR = 48;

export const PIXELS_PER_MINUTE = PIXELS_PER_HOUR / 60;

/** 分钟 → 像素（可夹在 [0, 一天高度] 内） */
export function minutesToPixels(minutes: number): number {
	return minutes * PIXELS_PER_MINUTE;
}

/** 像素 → 分钟（可夹在 [0, 1440] 内） */
export function pixelsToMinutes(pixels: number): number {
	const raw = pixels / PIXELS_PER_MINUTE;
	return Math.min(MINUTES_PER_DAY, Math.max(0, raw));
}

/** 吸附到 15 分钟网格（拖拽落位与键盘改时间都走它） */
export function snapToGrid(minutes: number): number {
	// `+ 0` 把 -0 归一成 0 —— 否则负数吸完会得到 `-0`，再格式化钟点就成了 "-0:00"
	return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES + 0;
}

/** 事件块的高度（像素）：时长 × 每分钟像素，但不低于 24px */
export function blockHeight(
	block: Pick<AxisBlock, "startMinute" | "endMinute">,
): number {
	const span = Math.max(0, block.endMinute - block.startMinute);
	return Math.max(MIN_BLOCK_HEIGHT, minutesToPixels(span));
}

/**
 * 块高度分档（06-日历视图 §4.2）：用于决定放多少行文字。
 *
 * | 档 | 时长 | 放什么 |
 * |---|---|---|
 * | 极短 | < 30 分钟 | 只有标题 |
 * | 短 | 30–60 | 标题 + 时间 |
 * | 中 | 60–120 | 标题 + 时间 |
 * | 长 | > 120 | 标题 + 时间 + 时长 |
 */
export type BlockSize = "tiny" | "short" | "medium" | "long";

export function blockSize(minutes: number): BlockSize {
	if (minutes < SHORT_EVENT_MINUTES) return "tiny";
	if (minutes < 60) return "short";
	if (minutes <= 120) return "medium";
	return "long";
}

// ── 重叠布局：贪心区间图着色 ──

/**
 * 给一组块算列号。
 *
 * 列 = 可复用的竖条。同列的块**互不重叠**，所以每列宽 `1/columns` 即可；
 * `columns` 是最大同时重叠数（贪心的最优性保证，见文件头）。
 *
 * 输入会被**复制后排序**，不改调用方的数组。
 */
export function layoutOverlaps(blocks: readonly AxisBlock[]): LaidOutBlock[] {
	// 按开始时间排；开始相同则短的在前（长的占更多列，先给它选）
	const sorted = [...blocks].sort(
		(a, b) =>
			a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.id - b.id,
	);

	// 每列记"这一列上一个块结束在哪"，半开区间下 `end <= start` 即可复用
	const columnEnds: number[] = [];
	const assigned = sorted.map((block) => {
		let column = columnEnds.findIndex((end) => end <= block.startMinute);
		if (column === -1) {
			column = columnEnds.length;
			columnEnds.push(block.endMinute);
		} else {
			columnEnds[column] = block.endMinute;
		}
		return { block, column };
	});

	const columns = Math.max(1, columnEnds.length);
	return assigned.map(({ block, column }) => ({ ...block, column, columns }));
}

// ── 关键时刻的像素位置 ──

/** 小时刻度的标签与位置（整点） */
export interface HourMark {
	hour: number;
	label: string;
	/** 距顶像素 */
	top: number;
}

/** 0–23 点的刻度 */
export function hourMarks(): HourMark[] {
	return Array.from({ length: 24 }, (_, hour) => ({
		hour,
		label: `${String(hour).padStart(2, "0")}:00`,
		top: minutesToPixels(hour * 60),
	}));
}

/** 当前时刻在轴上的像素位置；不在今天返回 null（时间线不画） */
export function nowLineTop(now: Date): number | null {
	const minute = now.getHours() * 60 + now.getMinutes();
	return minutesToPixels(minute);
}

// ── 鼠标位置 ↔ 时刻 ──

/**
 * 拖拽落点：鼠标的 Y 坐标 → 该天的时刻（已吸附到 15 分钟）。
 *
 * 夹在 [0, 一天结束] 内 —— 拖到轴外不该产生负数时刻或跨天。
 */
export function dragOffsetToMinute(offsetY: number): number {
	return snapToGrid(pixelsToMinutes(offsetY));
}

/** 一段事件在**某一天**的投影（跨天事件跨到的那天用这个裁） */
export function projectToDay(
	block: Pick<AxisBlock, "startMinute" | "endMinute">,
	dayOffset: number,
): { startMinute: number; endMinute: number } {
	const dayStart = dayOffset * MINUTES_PER_DAY;
	const from = Math.max(0, block.startMinute - dayStart);
	const to = Math.min(MINUTES_PER_DAY, block.endMinute - dayStart);
	return { startMinute: from, endMinute: Math.max(from, to) };
}
