// 落位的反馈契约（S5-d 具体文案 / S5-k 撤销而非确认框）。
// API 层被 mock 掉，这里只测"我们怎么说话、失败了给不给反悔的路"。

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const createTaskE = vi.fn();
const updateTimeWindowE = vi.fn();
const notifyError = vi.fn();
const notifySuccess = vi.fn();
let toastItem: Record<string, unknown> | null = null;

vi.mock("../api.ts", () => ({
	createTaskE: (...args: unknown[]) => createTaskE(...args),
}));
vi.mock("../timeWindowApi.ts", () => ({
	updateTimeWindowE: (...args: unknown[]) => updateTimeWindowE(...args),
}));
vi.mock("@shared/errors", () => ({
	notifyError: (...args: unknown[]) => notifyError(...args),
	notifySuccess: (...args: unknown[]) => notifySuccess(...args),
}));
vi.mock("@shared/utils/toastStore.ts", () => ({
	showToast: (item: Record<string, unknown>) => {
		toastItem = item;
		return 1;
	},
}));

const { scheduleWindow, toIso } = await import("./schedule.ts");

describe("toIso：当天零点 + N 分钟 → ISO", () => {
	it("换算正确", () => {
		expect(toIso("2026-10-03", 9 * 60 + 30)).toBe(
			new Date(2026, 9, 3, 9, 30).toISOString(),
		);
	});
});

describe("scheduleWindow", () => {
	afterEach(() => {
		vi.clearAllMocks();
		toastItem = null;
	});

	it("点空白新建：一次请求带任务 + 窗口，不留半成功态", async () => {
		createTaskE.mockResolvedValue({ id: 9 });
		const done = vi.fn();

		const ok = await scheduleWindow(
			{
				windowId: null,
				dayKey: "2026-10-03",
				startMinute: 540,
				endMinute: 570,
				title: "写周报",
			},
			done,
		);

		expect(ok).toBe(true);
		expect(createTaskE).toHaveBeenCalledTimes(1);
		const payload = createTaskE.mock.calls[0][0] as {
			title: string;
			planned_window: { start: string; end: string };
		};
		expect(payload.title).toBe("写周报");
		expect(payload.planned_window.start).toBe(toIso("2026-10-03", 540));
		expect(payload.planned_window.end).toBe(toIso("2026-10-03", 570));
		expect(done).toHaveBeenCalled();
	});

	it("新建没给标题时有个兜底，不发空标题出去", async () => {
		createTaskE.mockResolvedValue({});
		await scheduleWindow({
			windowId: null,
			dayKey: "2026-10-03",
			startMinute: 540,
			endMinute: 570,
			title: "   ",
		});
		expect((createTaskE.mock.calls[0][0] as { title: string }).title).toBe(
			"未命名任务",
		);
	});

	it("移动已有窗口：PATCH 那条时间窗，只带起止", async () => {
		updateTimeWindowE.mockResolvedValue({});
		await scheduleWindow({
			windowId: 101,
			dayKey: "2026-10-03",
			startMinute: 600,
			endMinute: 660,
			previous: {
				start: toIso("2026-10-03", 540),
				end: toIso("2026-10-03", 600),
			},
		});

		expect(updateTimeWindowE).toHaveBeenCalledWith(101, {
			start_time: toIso("2026-10-03", 600),
			end_time: toIso("2026-10-03", 660),
		});
		expect(createTaskE).not.toHaveBeenCalled();
	});

	it("S5-d：失败时带出后端的中文 message（不是通用 toast）", async () => {
		updateTimeWindowE.mockRejectedValue(
			new Error("计划时间段 [10:00, 11:00] 不在任何可行时间窗口内"),
		);

		const ok = await scheduleWindow({
			windowId: 101,
			dayKey: "2026-10-03",
			startMinute: 600,
			endMinute: 660,
			previous: { start: "a", end: "b" },
		});

		expect(ok).toBe(false);
		expect(toastItem?.message).toContain("不在任何可行时间窗口内");
	});

	it("S5-k：移动失败给「撤销」，且不弹确认框", async () => {
		updateTimeWindowE.mockRejectedValue(new Error("这段时间已经有一件事了"));
		await scheduleWindow({
			windowId: 101,
			dayKey: "2026-10-03",
			startMinute: 600,
			endMinute: 660,
			previous: {
				start: toIso("2026-10-03", 540),
				end: toIso("2026-10-03", 600),
			},
		});

		const action = toastItem?.action as
			| { label: string; onClick: () => void }
			| undefined;
		expect(action?.label).toBe("撤销");
		// 没有"是否继续"这类确认 —— 移动已经发生了，该问的是要不要反悔
		expect(toastItem?.type).toBe("error");

		// 点撤销 → 回到拖之前的位置
		updateTimeWindowE.mockClear();
		updateTimeWindowE.mockResolvedValue({});
		action?.onClick();
		expect(updateTimeWindowE).toHaveBeenCalledWith(101, {
			start_time: toIso("2026-10-03", 540),
			end_time: toIso("2026-10-03", 600),
		});
	});

	it("拿不到旧位置时不给撤销（给了也撤不回去），但仍说清原因", async () => {
		updateTimeWindowE.mockRejectedValue(new Error("时间重叠"));
		await scheduleWindow({
			windowId: 101,
			dayKey: "2026-10-03",
			startMinute: 600,
			endMinute: 660,
			previous: null,
		});

		expect(toastItem?.message).toContain("时间重叠");
		expect(toastItem?.action).toBeUndefined();
	});

	it("新建失败走 notifyError，并把后端的话带出来", async () => {
		createTaskE.mockRejectedValue(new Error("标题长度必须在1-255字符之间"));
		await scheduleWindow({
			windowId: null,
			dayKey: "2026-10-03",
			startMinute: 540,
			endMinute: 570,
			title: "x",
		});

		expect(notifyError).toHaveBeenCalledWith(
			"没能排上",
			expect.stringContaining("标题长度"),
		);
	});
});
