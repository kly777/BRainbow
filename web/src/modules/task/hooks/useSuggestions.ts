// 建议图层的取数与开关（S6-7）。
//
// **图层默认开**，但用户可以关掉专注执行 —— 这是 P9 的第二层保险："不采纳也是一种操作"。
//
// 每次落位/改时段之后要重取：建议的依据就是"此刻的日历"，缓存会让它停留在旧状态
// （那比慢 20ms 糟糕得多）。所以这里不做缓存，只在 `rangeKey` 与 `refresh()` 变化时取。

import { notifyError } from "@shared/errors";
import { createResource, createSignal } from "solid-js";
import { getSuggestionsE } from "../api.ts";
import type { SlotSuggestion, SuggestionsResponse } from "../api-types.ts";

export interface SuggestionsApi {
	/** 建议（纯读；后端没写任何东西） */
	suggestions: () => readonly SlotSuggestion[];
	/** 排不下的任务 + 原因 */
	unscheduled: () => SuggestionsResponse["unscheduled"];
	capacity: () => SuggestionsResponse["capacity"];
	loading: () => boolean;
	/** 图层开关，默认开 */
	enabled: () => boolean;
	setEnabled: (value: boolean) => void;
	/** 重新取数（采纳/拖拽之后调） */
	refresh: () => void;
}

const ENABLED_KEY = "brainbow_calendar_suggestions";

/** 图层开关（localStorage；没设过 = 开） */
export function suggestionsEnabled(): boolean {
	return localStorage.getItem(ENABLED_KEY) !== "off";
}

export function persistSuggestionsEnabled(value: boolean): void {
	if (value) {
		localStorage.removeItem(ENABLED_KEY);
	} else {
		localStorage.setItem(ENABLED_KEY, "off");
	}
}

const EMPTY: SuggestionsResponse = {
	suggestions: [],
	unscheduled: [],
	capacity: { total_minutes: 0, used_minutes: 0, suggested_minutes: 0 },
};

export function useSuggestions(from: () => Date, to: () => Date) {
	const [enabled, setEnabledSignal] = createSignal(suggestionsEnabled());
	// 关掉图层时不发请求：它只用来画，建议自己不会随时间变
	const rangeKey = () =>
		enabled() ? `${from().toISOString()}|${to().toISOString()}` : null;

	const [data, { refetch }] = createResource(
		rangeKey,
		async (key): Promise<SuggestionsResponse> => {
			const [fromIso, toIso] = key.split("|");
			try {
				return await getSuggestionsE(fromIso, toIso);
			} catch (e) {
				// 建议失败不该挡住日历本身 —— 日历没有错误态槽位，提示一次就够了
				notifyError("算不出建议", e instanceof Error ? e.message : undefined);
				return EMPTY;
			}
		},
	);

	const setEnabled = (value: boolean) => {
		persistSuggestionsEnabled(value);
		setEnabledSignal(value);
	};

	return {
		suggestions: () => data()?.suggestions ?? EMPTY.suggestions,
		unscheduled: () => data()?.unscheduled ?? EMPTY.unscheduled,
		capacity: () => data()?.capacity ?? EMPTY.capacity,
		loading: () => data.loading,
		enabled,
		setEnabled,
		refresh: () => {
			if (enabled()) {
				void refetch();
			}
		},
	};
}
