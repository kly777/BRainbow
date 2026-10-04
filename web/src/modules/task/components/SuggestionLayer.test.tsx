// @vitest-environment jsdom
// 建议图层的渲染与采纳验收（S6-6 / S6-7 / S6-8 / S6-9 / S6-j / S6-k）。
//
// S6-a（GET /suggestions 之后库零变化）在后端：modules::task::query 的
// `suggestions_do_not_write`。这里只管前端这一侧：建议是画出来的，采纳是**一次点击**。

import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlotSuggestion } from "../api-types.ts";
import { useTaskCalendar } from "../hooks/useTaskCalendar.ts";
import CalendarTimeGrid from "./CalendarTimeGrid.tsx";
import {
	adoptSuggestion,
	CapacityBar,
	SuggestionBlock,
	UnscheduledList,
} from "./SuggestionLayer.tsx";

const getCalendarEventsE = vi.fn();
const getTimeWindowsE = vi.fn();
const createTimeWindowE = vi.fn();

vi.mock("@modules/task/api.ts", () => ({
	getCalendarEventsE: (...args: unknown[]) => getCalendarEventsE(...args),
	cachedRequest: vi.fn(),
}));

vi.mock("../timeWindowApi.ts", () => ({
	getTimeWindowsE: (...args: unknown[]) => getTimeWindowsE(...args),
	createTimeWindowE: (...args: unknown[]) => createTimeWindowE(...args),
}));

const notifySuccess = vi.fn();
vi.mock("@shared/errors", async (importOriginal) => ({
	...(await importOriginal<typeof import("@shared/errors")>()),
	notifySuccess: (...args: unknown[]) => notifySuccess(...args),
}));

// 采纳路径的确认框：默认"用户点了确认"，个别用例再改返回值
const showConfirm = vi.fn().mockResolvedValue(true);
vi.mock("@components/ui", async (importOriginal) => ({
	...(await importOriginal<typeof import("@components/ui")>()),
	showConfirm: (...args: unknown[]) => showConfirm(...args),
}));

const disposers: Array<() => void> = [];

/** 本地时刻构造（建议块的 top 按本地钟点算） */
const at = (h: number, min = 0) => new Date(2024, 0, 15, h, min).toISOString();

function suggestion(over: Partial<SlotSuggestion> = {}): SlotSuggestion {
	return {
		task_id: 1,
		title: "写周报",
		start: at(9),
		end: at(10),
		effort_minutes: 60,
		reason: "今天到期",
		score: 3.2,
		confidence: "high",
		...over,
	};
}

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	createRoot((dispose) => {
		render(node as never, host);
		disposers.push(dispose);
	});
	return host;
}

/** 挂整个时间轴（带建议图层）—— 采纳要走 CalendarTimeGrid → SuggestionBlock 这条路 */
function mountGrid(props: Record<string, unknown> = {}) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	createRoot((dispose) => {
		const calendar = useTaskCalendar();
		calendar.setGranularity("week");
		render(
			() => <CalendarTimeGrid calendar={calendar} showSuggestions {...props} />,
			host,
		);
		disposers.push(dispose);
	});
	return host;
}

/**
 * 建议块的根元素。类名是 CSS Modules 生成的 `_block_<hash>_<line>`（照 ConvSearch /
 * Skeleton 的测试惯例按片段找），**`div` 限定不能省** —— 块内部的 `block-time` /
 * `block-title` 也含 "block"。
 */
const draftBlocks = (host: HTMLElement) => [
	...host.querySelectorAll<HTMLElement>('div[class*="_block_"]'),
];

/** 等 resource 的数据落到 DOM 上（与 CalendarTimeGrid.test.tsx 同一套节奏） */
async function flush() {
	await vi.advanceTimersByTimeAsync(1);
	await Promise.resolve();
}

beforeEach(() => {
	localStorage.clear();
	// 时间轴画的是"当前这一周"，所以建议要落在同一周里 —— 把时钟也钉在 2024-01-15
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2024, 0, 15, 9, 0));
	getCalendarEventsE.mockResolvedValue([]);
	getTimeWindowsE.mockResolvedValue([]);
	createTimeWindowE.mockResolvedValue({ id: 1 });
	showConfirm.mockResolvedValue(true);
});

afterEach(() => {
	while (disposers.length > 0) {
		disposers.pop()?.();
	}
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("建议块（S6-6 / S6-j）", () => {
	it("三层信息都在：时间、标题、理由", () => {
		const host = mount(() => (
			<SuggestionBlock suggestion={suggestion()} onAdopt={() => {}} />
		));
		const block = draftBlocks(host)[0];
		expect(block.textContent).toContain("写周报");
		expect(block.textContent).toContain("今天到期");
	});

	it("S6-j：没有工时估计的任务 = low + 点线边框 + 「约」前缀", () => {
		const host = mount(() => (
			<SuggestionBlock
				suggestion={suggestion({ confidence: "low", title: "整理笔记" })}
				onAdopt={() => {}}
			/>
		));
		const block = draftBlocks(host)[0];
		expect(block.className).toContain("_low_");
		expect(block.textContent).toContain("约 整理笔记");
		// 理由行如实说「时长是估的」，不编一个理由出来
		expect(block.textContent).toContain("时长是估的");
	});

	it("high 与 medium 都不加「约」，理由照服务端给的那条", () => {
		const host = mount(() => (
			<>
				<SuggestionBlock suggestion={suggestion()} onAdopt={() => {}} />
				<SuggestionBlock
					suggestion={suggestion({
						task_id: 2,
						title: "读论文",
						confidence: "medium",
						reason: "优先级高",
					})}
					onAdopt={() => {}}
				/>
			</>
		));
		const [first, second] = draftBlocks(host);
		expect(first.textContent).toContain("写周报");
		expect(first.textContent).not.toContain("约");
		expect(second.textContent).toContain("读论文");
		expect(second.textContent).toContain("优先级高");
	});

	it("采纳按钮带任务名的可访问名（读屏能分清采纳的是哪条）", () => {
		const host = mount(() => (
			<SuggestionBlock suggestion={suggestion()} onAdopt={() => {}} />
		));
		const button = host.querySelector("button");
		expect(button?.getAttribute("aria-label")).toBe("采纳建议：写周报");
	});
});

describe("采纳（S6-8）", () => {
	it("在 feasible 内 → 直接落成 planned，不问", async () => {
		getTimeWindowsE.mockResolvedValue([
			{ id: 9, start_time: at(8), end_time: at(12), window_type: "feasible" },
		]);

		const ok = await adoptSuggestion(1, at(9), at(10), async () => {
			throw new Error("不该问");
		});

		expect(ok).toBe(true);
		expect(createTimeWindowE).toHaveBeenCalledWith({
			start_time: at(9),
			end_time: at(10),
			window_type: "planned",
			task_id: 1,
		});
		expect(notifySuccess).toHaveBeenCalled();
	});

	it("不在任何 feasible 内 → 问一次；用户取消则**不落库**", async () => {
		const confirm = vi.fn().mockResolvedValue(false);

		const ok = await adoptSuggestion(1, at(9), at(10), confirm);

		expect(ok).toBe(false);
		expect(confirm).toHaveBeenCalledWith(at(9), at(10));
		expect(createTimeWindowE).not.toHaveBeenCalled();
	});

	it("不在 feasible 内但用户确认 → 落成 planned", async () => {
		const confirm = vi.fn().mockResolvedValue(true);

		const ok = await adoptSuggestion(2, at(14), at(15), confirm);

		expect(ok).toBe(true);
		expect(createTimeWindowE).toHaveBeenCalledWith({
			start_time: at(14),
			end_time: at(15),
			window_type: "planned",
			task_id: 2,
		});
	});

	it("点采纳按钮 → 落到建议自己的区间上（点了才写）", async () => {
		const adopt = vi.fn();
		const host = mountGrid({
			suggestions: () => [suggestion()],
			onAdoptSuggestion: adopt,
		});
		await flush();

		draftBlocks(host)[0]?.querySelector("button")?.click();

		expect(adopt).toHaveBeenCalledWith(1, at(9), at(10));
	});
});

describe("图层开关（S6-7）", () => {
	it("S6-b：建议块画在轴上（虚线 + accent 底是它「淡」的来源）", async () => {
		const host = mountGrid({ suggestions: () => [suggestion()] });
		await flush();
		expect(draftBlocks(host).length).toBe(1);
	});

	it("S6-e：关掉图层 → 建议块全部消失，真实事件不动", async () => {
		const host = mountGrid({ suggestions: () => [] });
		await flush();
		expect(draftBlocks(host).length).toBe(0);
	});

	it("onToggleSuggestions 收到新的勾选状态", async () => {
		const onToggle = vi.fn();
		const host = mountGrid({
			suggestions: () => [suggestion()],
			suggestionsEnabled: () => true,
			onToggleSuggestions: onToggle,
		});
		await flush();

		const checkbox = host.querySelector<HTMLInputElement>(
			'input[type="checkbox"]',
		);
		expect(checkbox?.checked).toBe(true);
		if (checkbox) {
			checkbox.checked = false;
			checkbox.dispatchEvent(new Event("change", { bubbles: true }));
		}
		expect(onToggle).toHaveBeenCalledWith(false);
	});

	it("S6-k：说「基于你已安排的时段」，**没有**「你的空闲时间」", async () => {
		const host = mountGrid({ suggestions: () => [] });
		await flush();
		const text = host.textContent ?? "";
		expect(text).toContain("基于你已安排的时段");
		expect(text).not.toContain("空闲时间");
	});
});

describe("排不下的清单与容量账（S6-9 / S6-f）", () => {
	it("S6-h：带原因列出来（阻塞会写明等谁）", () => {
		const host = mount(() => (
			<UnscheduledList
				items={[
					{ task_id: 3, title: "部署", reason: "等「测试通过」完成" },
					{ task_id: 4, title: "写文档", reason: "这段时间排不下了" },
				]}
			/>
		));
		const text = host.textContent ?? "";
		expect(text).toContain("部署");
		expect(text).toContain("等「测试通过」完成");
		expect(text).toContain("写文档");
		expect(text).toContain("这段时间排不下了");
		// 是地标而不是无声的 div：aria-label 落在 section 上读屏才播报
		expect(
			host.querySelector('[aria-label="排不下的任务"]')?.tagName.toLowerCase(),
		).toBe("section");
	});

	it("清单为空时整块不占位置", () => {
		const host = mount(() => <UnscheduledList items={[]} />);
		expect(host.textContent).toBe("");
	});

	it("容量账：总量 / 已占 / 本次建议都在名字里（读屏也读得到）", () => {
		const host = mount(() => (
			<CapacityBar total={480} used={120} suggested={90} />
		));
		const bar = host.querySelector('[role="img"]');
		expect(bar?.getAttribute("aria-label")).toBe(
			"工作时段 480 分钟，已占 120，本次建议 90",
		);
		// 视觉版：小时取整（480 → 8 小时）
		expect(host.textContent).toContain("8 小时里已占 2");
	});
});
