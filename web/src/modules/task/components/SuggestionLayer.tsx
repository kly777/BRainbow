// 建议图层（S6-6/7/8/9）：虚线建议块 + 采纳 + 排不下的清单。
//
// ## 视觉：建议必须比真实事件淡（P9 在视觉上的落点）
//
// 如果建议长得和真实安排一样，用户就分不清"这是承诺"还是"这是系统的猜测"——
// 而那正是 P9 要保住的东西。三种置信度靠**边框线型 + 标题前缀 + 理由行**区分：
//
// | 置信度 | 边框 | 标题 | 理由行 |
// |---|---|---|---|
// | high | 虚线 | 原样 | 最高贡献的那条 |
// | medium | 虚线 | 原样 | 最高贡献的那条（截断/远期） |
// | low | **点线** | 前缀「约」 | 显式写"时长是估的" |
//
// ## 采纳（方案 C，见 05 §3.5）
//
// 采纳 = 显式 `POST /api/time-windows`。如果那个区间不在任何 `feasible` 里，
// **问一次**（"这段时间不在你标记的可行时段里，仍要排上吗？"）—— 不静默排，
// 也不自动建配套的 `feasible` 去污染用户数据。
//
// **不采纳零成本**：关掉图层就等于全部不采纳，不需要逐条解释。

import { showToast } from "@components/ui";
import { notifySuccess } from "@shared/errors";
import { For, Show } from "solid-js";
import type { SlotSuggestion } from "../api-types.ts";
import { minutesToPixels } from "../lib/calendarAxis.ts";
import { createTimeWindowE, getTimeWindowsE } from "../timeWindowApi.ts";
import styles from "./SuggestionLayer.module.css";

/** 建议块的呈现（与真实事件块的几何一致，只是画法不同） */
export function SuggestionBlock(props: {
	suggestion: SlotSuggestion;
	onAdopt: (taskId: number, start: string, end: string) => void;
}) {
	const s = () => props.suggestion;
	const clock = (iso: string) =>
		new Date(iso).toLocaleTimeString("zh-CN", {
			hour: "2-digit",
			minute: "2-digit",
		});

	const top = () => {
		const start = new Date(s().start);
		return start.getHours() * 60 + start.getMinutes();
	};
	const height = () => {
		const start = new Date(s().start);
		const end = new Date(s().end);
		return Math.max(0, (end.getTime() - start.getTime()) / 60_000);
	};

	return (
		<div
			class={styles.block}
			classList={{
				[styles.low]: s().confidence === "low",
				[styles.medium]: s().confidence === "medium",
			}}
			style={{
				top: `${minutesToPixels(top())}px`,
				height: `${minutesToPixels(height())}px`,
			}}
		>
			<span class={styles.blockTime}>{clock(s().start)}</span>
			{/* low 置信度加「约」前缀：它不是承诺，只是系统的猜测 */}
			<span class={styles.blockTitle}>
				{s().confidence === "low" ? `约 ${s().title}` : s().title}
			</span>
			<span class={styles.blockReason}>
				{s().confidence === "low" ? "时长是估的" : s().reason}
			</span>
			{/* 采纳按钮位置常驻（不 hover 才出现，理由同月网格的折叠行） */}
			<button
				type="button"
				class={styles.adopt}
				aria-label={`采纳建议：${s().title}`}
				onClick={() => props.onAdopt(s().task_id, s().start, s().end)}
			>
				▢
			</button>
		</div>
	);
}

/** 排不下的清单（带原因 —— S6-f 的诚实） */
export function UnscheduledList(props: {
	items: readonly { task_id: number; title: string; reason: string }[];
	onOpenTask?: (taskId: number) => void;
}) {
	return (
		<Show when={props.items.length > 0}>
			{/* section 而不是 div：带可访问名的地标读屏会播报，
			    普通 div 上的 aria-label 会被忽略 */}
			<section class={styles.unscheduled} aria-label="排不下的任务">
				<h4 class={styles.unscheduledTitle}>
					这段时间排不下（{props.items.length}）
				</h4>
				<ul class={styles.unscheduledList}>
					<For each={props.items}>
						{(item) => (
							<li class={styles.unscheduledItem}>
								<button
									type="button"
									class={styles.unscheduledLink}
									onClick={() => props.onOpenTask?.(item.task_id)}
								>
									{item.title}
								</button>
								<span class={styles.unscheduledReason}>{item.reason}</span>
							</li>
						)}
					</For>
				</ul>
			</section>
		</Show>
	);
}

/** 容量账：让用户看得见"这段时间一共多少、占了多少、这次建议占多少" */
export function CapacityBar(props: {
	total: number;
	used: number;
	suggested: number;
}) {
	const parts = () => {
		const total = Math.max(1, props.total);
		return {
			used: (props.used / total) * 100,
			suggested: (props.suggested / total) * 100,
		};
	};

	return (
		<div class={styles.capacity}>
			{/* 容量条是图形，读屏靠这个 role=img 的名字；旁边的文字是同一份信息的视觉版 */}
			<div
				class={styles.capacityBar}
				role="img"
				aria-label={`工作时段 ${props.total} 分钟，已占 ${props.used}，本次建议 ${props.suggested}`}
			>
				<span
					class={styles.capacityUsed}
					style={{ width: `${parts().used}%` }}
				/>
				<span
					class={styles.capacitySuggested}
					style={{ width: `${parts().suggested}%` }}
				/>
			</div>
			<span class={styles.capacityText}>
				{Math.round(props.total / 60)} 小时里已占 {Math.round(props.used / 60)}
				， 建议 {Math.round(props.suggested / 60)}
			</span>
		</div>
	);
}

/**
 * 采纳一条建议。
 *
 * 区间不在任何 `feasible` 里时**问一次**（05 §3.5 的方案 C）：不静默排，也不自动建
 * 配套的 `feasible` 去污染用户数据。
 */
export async function adoptSuggestion(
	taskId: number,
	start: string,
	end: string,
	confirmOutsideFeasible: (start: string, end: string) => Promise<boolean>,
): Promise<boolean> {
	const feasible = await getTimeWindowsE(taskId, "feasible").catch(
		() => [] as const,
	);
	const covered = feasible.some(
		(window) =>
			new Date(window.start_time) <= new Date(start) &&
			new Date(window.end_time) >= new Date(end),
	);
	if (!covered && !(await confirmOutsideFeasible(start, end))) {
		return false;
	}
	try {
		await createTimeWindowE({
			start_time: start,
			end_time: end,
			window_type: "planned",
			task_id: taskId,
		});
		notifySuccess("已排上");
		return true;
	} catch (e) {
		showToast({
			type: "error",
			title: "没能排上",
			message: e instanceof Error ? e.message : "这段时间排不下了",
		});
		return false;
	}
}
