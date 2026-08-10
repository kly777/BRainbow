// ── AI 生成记忆卡片：调度层 hook ──
// 生成（文本 → 卡片）与渐进修改（指令 → 修订现有卡片）。
// 依赖注入：callAi 可 mock（默认走 lib/ai.ts 全局配置）。

import { createSignal } from "solid-js";
import { getErrorMessage } from "@apis/types/index.ts";
import { callAi } from "@lib/ai.ts";
import { tryAsync } from "@lib/result.ts";
import {
	buildGeneratePrompt,
	buildRevisePrompt,
	parseAiCards,
	type AiCard,
} from "@features/mem/logic/ai-cards.ts";

export interface UseMemAi {
	text: () => string;
	setText: (v: string) => void;
	cards: () => AiCard[];
	loading: () => boolean;
	error: () => string;
	/** 用当前文本生成卡片（结果覆盖上次） */
	generate: () => Promise<void>;
	/** 更新某张卡（人工微调） */
	updateCard: (i: number, patch: Partial<AiCard>) => void;
	/** 按指令让 AI 修订全部卡片（可增删改） */
	reviseAll: (instruction: string) => Promise<void>;
	/** 重新生成（换一批角度） */
	clear: () => void;
}

export function useMemAi(deps: { callAi?: typeof callAi } = {}): UseMemAi {
	const aiCall = deps.callAi ?? callAi;

	const [text, setText] = createSignal("");
	const [cards, setCards] = createSignal<AiCard[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal("");
	const [source, setSource] = createSignal("");

	const run = async (build: () => string) => {
		setLoading(true);
		setError("");
		const result = await tryAsync(() =>
			aiCall({
				messages: [{ role: "user", content: build() }],
				temperature: 0.3,
			}),
		);
		setLoading(false);
		if (!result.ok) {
			setError(getErrorMessage(result.error));
			return null;
		}
		const parsed = parseAiCards(result.value.content);
		if (!parsed.ok) {
			setError(parsed.error);
			return null;
		}
		return parsed.value;
	};

	const generate = async () => {
		const t = text().trim();
		if (!t) return;
		const value = await run(() => buildGeneratePrompt(t));
		if (value) {
			setSource(t);
			setCards(value);
		}
	};

	const reviseAll = async (instruction: string) => {
		const inst = instruction.trim();
		if (!inst || cards().length === 0) return;
		const value = await run(() => buildRevisePrompt(source(), cards(), inst));
		if (value) setCards(value);
	};

	const updateCard = (i: number, patch: Partial<AiCard>) => {
		setCards((prev) => {
			const next = [...prev];
			if (i >= 0 && i < next.length) next[i] = { ...next[i], ...patch };
			return next;
		});
	};

	const clear = () => {
		setCards([]);
		setError("");
		setSource("");
	};

	return {
		text,
		setText,
		cards,
		loading,
		error,
		generate,
		updateCard,
		reviseAll,
		clear,
	};
}
