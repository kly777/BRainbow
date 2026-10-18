// ── 拖拽落位的状态机（纯函数）──
//
// 反馈契约照 Apple HIG 的 Drag and drop（06-日历视图 §6.1），四条都是**硬要求**：
//
// 1. **3pt 阈值才进入拖拽**：位移不足就是点击。不设阈值时"点开详情"会被误判成拖拽，
//    点选功能就废了（S5-i）
// 2. **只对合法落点高亮**：非法目标**不给**任何高亮 —— 给出"这里可以放"的错觉比不给更糟
// 3. **拖离合法落点，高亮立刻消失**（不是等 mouseup）
// 4. **失败走撤销，不是确认框**（C001 不通过时直接落位 + toast「撤销」）
//
// **合法性的判定是本地的**：C001/C002 是服务端规则，客户端只有"这一天已有哪些
// planned/actual"这一个可算的依据。所以这里做的是**预测**（够用的反馈），
// 真正的裁决仍在服务端 —— 预测错了会由服务端的错误文案兜住（S5-d 要的是
// "这段时间已经有一件事了"这种具体信息，而不是通用 toast）。

/** 拖动位移阈值（pt/px）。低于它就是点击 */
export const DRAG_THRESHOLD_PX = 3;

/** 一天的分钟数 */
const MINUTES_PER_DAY = 24 * 60;

export interface DragBlock {
	taskId: number;
	title: string;
	startMinute: number;
	endMinute: number;
}

export type DragPhase =
	/** 还没超过阈值 —— 按点击处理 */
	| "idle"
	/** 超过阈值，正在拖（跟手阶段） */
	| "dragging"
	/** 松手了，正在落位 */
	| "dropping";

export interface DragState {
	phase: DragPhase;
	/** 累计位移（px），未超过阈值时也记着 —— 用来判断"到底算不算拖" */
	travel: number;
	/** 落点：吸附后的分钟（仅 dragging/dropping 有意义） */
	targetMinute: number;
	/** 拖的那一段时长（分钟） */
	durationMinutes: number;
	/** 当前落点是否合法（预测） */
	legal: boolean;
}

export const INITIAL_DRAG: DragState = {
	phase: "idle",
	travel: 0,
	targetMinute: 0,
	durationMinutes: 0,
	legal: true,
};

/** pointer move：累计位移，超过阈值才进 dragging */
export function onPointerMove(
	state: DragState,
	offsetY: number,
	/** Y 偏移（像素）→ 吸附后的分钟。注入是为了让像素↔分钟的换算只存在于
	 *  `calendarAxis.ts` 一处，这里不重复知道"每分钟多少像素" */
	toMinute: (offsetYPixels: number) => number,
): DragState {
	const travel = Math.abs(offsetY);
	// 阈值之前不动相位 —— 这一段必须保持"点击"的语义（S5-i）
	if (state.phase === "idle" && travel < DRAG_THRESHOLD_PX) {
		return state;
	}
	return {
		...state,
		phase: "dragging",
		travel,
		targetMinute: toMinute(offsetY),
	};
}

/** pointer up：只有真的拖了才落位，否则返回 null（当作点击） */
export function onPointerUp(state: DragState): DragState | null {
	return state.phase === "dragging" ? { ...state, phase: "dropping" } : null;
}

/** 取消（Esc / pointercancel）：回到 idle，不落位（WCAG 2.5.2 可中止） */
export function cancelDrag(): DragState {
	return { ...INITIAL_DRAG, durationMinutes: 0 };
}

// ── 合法性预测 ──

export interface DropPreview {
	startMinute: number;
	endMinute: number;
	legal: boolean;
	/** 非法时给用户看的话（要具体，不能是"操作失败"） */
	hint: string | null;
}

/**
 * 算落点预览。
 *
 * 与既有 `planned`/`actual` 重叠 → 预测非法（S5-d 的 C002：同一时间轴上不该有
 * 两件已安排的事）。`feasible` **不**参与冲突判定 —— 它是"我大概有空"，
 * 往空档里排才是对的（真要占它，C001 在服务端把关）。
 */
export function previewDrop(
	targetMinute: number,
	durationMinutes: number,
	existing: readonly DragBlock[],
): DropPreview {
	const start = Math.max(
		0,
		Math.min(MINUTES_PER_DAY - durationMinutes, targetMinute),
	);
	const end = start + durationMinutes;
	const conflict = existing.find(
		(block) => start < block.endMinute && end > block.startMinute,
	);
	return conflict
		? {
				startMinute: start,
				endMinute: end,
				legal: false,
				hint: `这段时间已经有一件事了：「${conflict.title}」`,
			}
		: { startMinute: start, endMinute: end, legal: true, hint: null };
}

/** 一天的冲突集合（由事件派生，供 previewDrop 用） */
export function blocksOfDay(
	events: readonly {
		taskId: number;
		title: string;
		startMinute: number;
		endMinute: number;
		windowType: string;
	}[],
): DragBlock[] {
	return events
		.filter((e) => e.windowType === "planned" || e.windowType === "actual")
		.map((e) => ({
			taskId: e.taskId,
			title: e.title,
			startMinute: e.startMinute,
			endMinute: e.endMinute,
		}));
}

// ── 键盘等价路径（S5-f 的硬要求）──
//
// 拖拽只有鼠标能用，就等于对一部分用户不可用。WCAG 2.5.7 点名了两种等价形态，
// 两条都给：① `Enter` 进"改时间"的数字输入 ② `↑/↓` 直接上移下移一格 15 分钟。

/** `↑/↓` 移一格（默认 15 分钟） */
export function nudgeMinutes(
	targetMinute: number,
	delta: -1 | 1,
	stepMinutes = 15,
	durationMinutes = 30,
): number {
	const next = targetMinute + delta * stepMinutes;
	// 不许移出这一天
	return Math.max(0, Math.min(MINUTES_PER_DAY - durationMinutes, next));
}

/** 键盘改动时间的输入文本（`Enter` 进的那条路径用） */
export function parseTimeInput(input: string): number | null {
	const text = input.trim();
	if (text === "") {
		return null; // 空 = 清除
	}
	const match = /^(\d{1,2}):(\d{2})$/.exec(text);
	if (!match) {
		return null;
	}
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour > 23 || minute > 59) {
		return null;
	}
	return hour * 60 + minute;
}

export function formatTimeInput(minute: number): string {
	const hour = Math.floor(minute / 60);
	const rest = minute % 60;
	return `${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
