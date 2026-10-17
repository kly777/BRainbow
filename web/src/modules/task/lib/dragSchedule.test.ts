// 拖拽落位的反馈契约（Apple HIG，06-日历视图 §6.1）+ 键盘等价路径。
// 每条测试都对着验收表的一个编号。

import { describe, expect, it } from "vite-plus/test";
import { dragOffsetToMinute } from "./calendarAxis.ts";
import type { DragBlock } from "./dragSchedule.ts";
import {
	blocksOfDay,
	cancelDrag,
	DRAG_THRESHOLD_PX,
	formatTimeInput,
	INITIAL_DRAG,
	nudgeMinutes,
	onPointerMove,
	onPointerUp,
	parseTimeInput,
	previewDrop,
} from "./dragSchedule.ts";

/** Y 偏移（像素）→ 吸附后的分钟；与时间轴用的是同一个换算 */
const toMinute = dragOffsetToMinute;

describe("S5-i：3pt 阈值 —— 位移不足就是点击", () => {
	it("没超阈值：相位不变（点选不被误判成拖拽）", () => {
		const state = onPointerMove(INITIAL_DRAG, DRAG_THRESHOLD_PX - 1, toMinute);
		expect(state.phase).toBe("idle");
	});

	it("恰好等于阈值：进入拖拽", () => {
		expect(onPointerMove(INITIAL_DRAG, DRAG_THRESHOLD_PX, toMinute).phase).toBe(
			"dragging",
		);
	});

	it("超过阈值：进入拖拽，落点已吸附到 15 分钟", () => {
		const state = onPointerMove(INITIAL_DRAG, 10, toMinute);
		expect(state.phase).toBe("dragging");
		expect(state.targetMinute).toBe(15);
	});

	it("没超阈值就松手 → 判定为点击（返回 null，不落位）", () => {
		const moved = onPointerMove(INITIAL_DRAG, 2, toMinute);
		expect(onPointerUp(moved)).toBeNull();
	});

	it("拖过了再松手 → 落位", () => {
		const moved = onPointerMove(INITIAL_DRAG, 40, toMinute);
		const dropped = onPointerUp(moved);
		expect(dropped?.phase).toBe("dropping");
	});
});

describe("取消拖拽（WCAG 2.5.2 可中止）", () => {
	it("Esc / pointercancel 回到 idle，且不留目标分钟", () => {
		const dragging = onPointerMove(INITIAL_DRAG, 100, toMinute);
		const cancelled = cancelDrag();
		expect(cancelled.phase).toBe("idle");
		expect(cancelled.targetMinute).toBe(0);
		expect(onPointerUp(dragging)).not.toBeNull();
	});
});

describe("S5-j / S5-d：落点合法性与提示", () => {
	const day: DragBlock[] = [
		{ taskId: 1, title: "站会", startMinute: 540, endMinute: 600 },
	];

	it("空档：合法", () => {
		const preview = previewDrop(11 * 60, 60, day);
		expect(preview.legal).toBe(true);
		expect(preview.hint).toBeNull();
	});

	it("与既有安排重叠：预测非法，且**说清是谁挡着**（不是通用 toast）", () => {
		const preview = previewDrop(9 * 60 + 30, 60, day);
		expect(preview.legal).toBe(false);
		expect(preview.hint).toContain("这段时间已经有一件事了");
		expect(preview.hint).toContain("站会");
	});

	it("S5-j：拖离合法落点 → 预览立刻变非法（高亮消失）", () => {
		expect(previewDrop(11 * 60, 60, day).legal).toBe(true);
		expect(previewDrop(9 * 60, 60, day).legal).toBe(false);
	});

	it("半开区间：边界相接不算重叠（与 C002 同一约定）", () => {
		expect(previewDrop(10 * 60, 60, day).legal).toBe(true);
		expect(previewDrop(8 * 60, 60, day).legal).toBe(true);
	});

	it("落点不许移出这一天", () => {
		const preview = previewDrop(23 * 60 + 30, 60, []);
		expect(preview.endMinute).toBeLessThanOrEqual(24 * 60);
		const negative = previewDrop(-100, 60, []);
		expect(negative.startMinute).toBe(0);
	});

	it("`feasible` 不参与冲突判定（往空档里排才是对的）", () => {
		const blocks = blocksOfDay([
			{
				taskId: 1,
				title: "有空",
				startMinute: 540,
				endMinute: 600,
				windowType: "feasible",
			},
		]);
		expect(blocks).toEqual([]);
		expect(previewDrop(9 * 60, 60, blocks).legal).toBe(true);
	});

	it("planned 与 actual 都算占用", () => {
		const blocks = blocksOfDay([
			{
				taskId: 1,
				title: "已排",
				startMinute: 540,
				endMinute: 600,
				windowType: "planned",
			},
			{
				taskId: 2,
				title: "已做",
				startMinute: 660,
				endMinute: 720,
				windowType: "actual",
			},
		]);
		expect(blocks).toHaveLength(2);
		expect(previewDrop(11 * 60, 30, blocks).legal).toBe(false);
	});
});

describe("S5-f：键盘等价路径（两条都给）", () => {
	it("`↑/↓` 移一格 15 分钟", () => {
		expect(nudgeMinutes(600, 1)).toBe(615);
		expect(nudgeMinutes(600, -1)).toBe(585);
	});

	it("不许移出这一天", () => {
		expect(nudgeMinutes(0, -1)).toBe(0);
		expect(nudgeMinutes(23 * 60, 1, 15, 60)).toBe(23 * 60);
	});

	it("`Enter` 进的数字输入：`HH:MM` 解析与格式化互逆", () => {
		expect(parseTimeInput("09:30")).toBe(570);
		expect(formatTimeInput(570)).toBe("09:30");
		expect(formatTimeInput(parseTimeInput("23:05") as number)).toBe("23:05");
	});

	it("空串 = 清除；非法输入不猜", () => {
		expect(parseTimeInput("")).toBeNull();
		expect(parseTimeInput("9")).toBeNull();
		expect(parseTimeInput("25:00")).toBeNull();
		expect(parseTimeInput("09:70")).toBeNull();
		expect(parseTimeInput("下午三点")).toBeNull();
	});
});
