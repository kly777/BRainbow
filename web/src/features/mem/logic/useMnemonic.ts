// ── AI 助记：生成、加载、连续忘记自动触发 ──

import { createSignal } from "solid-js";
import { callAi } from "../../../lib/ai.ts";
import { fillPrompt, getAiSettings } from "../../../lib/ai-settings.ts";
import { notifyError } from "../../../lib/notify.ts";
import { tryAsync } from "../../../lib/result.ts";
import { getMnemonicE, setMnemonicE } from "../api.ts";
import type { MemItem } from "../model.ts";

/** 连续忘记 N 次后自动生成助记 */
const AUTO_GENERATE_THRESHOLD = 3;

export interface UseMnemonic {
	/** 当前卡片的助记内容（无则 undefined） */
	mnemonicFor: (memId: number | undefined) => string | undefined;
	loading: () => boolean;
	/** 加载助记：优先用 item 自带的，否则从后端取（失败静默） */
	load: (item: MemItem | undefined) => Promise<void>;
	/** 手动触发生成 */
	generate: (item: MemItem) => Promise<void>;
	/** 评分后调用：追踪连续忘记，达阈值且无助记时自动生成 */
	trackRating: (item: MemItem, rating: number) => void;
}

export function useMnemonic(): UseMnemonic {
	const [mnemonics, setMnemonics] = createSignal<Map<number, string>>(
		new Map(),
	);
	const [loading, setLoading] = createSignal(false);
	const [consecutiveForgets, setConsecutiveForgets] = createSignal<
		Map<number, number>
	>(new Map());

	const mnemonicFor = (memId: number | undefined) =>
		memId === undefined ? undefined : mnemonics().get(memId);

	const generate = async (item: MemItem) => {
		const settings = getAiSettings();
		if (!settings.apiKey) {
			notifyError(
				"未配置 API Key",
				new Error("请在顶栏 🤖 AI 设置中配置 API Key"),
			);
			return;
		}
		setLoading(true);

		const aiResult = await tryAsync(async () => {
			const prompt = fillPrompt(settings.mnemonicPrompt, {
				cue: item.cue.content,
				target: item.target.content,
			});
			return await callAi({
				messages: [{ role: "user", content: prompt }],
			});
		});

		if (aiResult.ok) {
			// 保存助记到后端（失败不影响用户体验——本地已缓存）
			tryAsync(() => setMnemonicE(item.id, aiResult.value.content));
			setMnemonics((prev) => {
				const next = new Map(prev);
				next.set(item.id, aiResult.value.content);
				return next;
			});
		} else {
			notifyError("AI 生成失败", aiResult.error);
		}
		setLoading(false);
	};

	const load = async (item: MemItem | undefined) => {
		if (!item) return;
		if (item.mnemonic) {
			setMnemonics((prev) => {
				const next = new Map(prev);
				next.set(item.id, item.mnemonic as string);
				return next;
			});
			return;
		}
		// 没有则尝试从后端单独获取（可选增强功能，失败不影响复习）
		const result = await tryAsync(() => getMnemonicE(item.id));
		if (result.ok && result.value.content) {
			setMnemonics((prev) => {
				const next = new Map(prev);
				next.set(item.id, result.value.content as string);
				return next;
			});
		}
	};

	const trackRating = (item: MemItem, rating: number) => {
		if (rating === 1) {
			setConsecutiveForgets((prev) => {
				const next = new Map(prev);
				const count = (next.get(item.id) ?? 0) + 1;
				next.set(item.id, count);
				if (count >= AUTO_GENERATE_THRESHOLD && !mnemonics().has(item.id)) {
					setTimeout(() => generate(item), 0);
				}
				return next;
			});
		} else {
			setConsecutiveForgets((prev) => {
				const next = new Map(prev);
				next.delete(item.id);
				return next;
			});
		}
	};

	return { mnemonicFor, loading, load, generate, trackRating };
}
