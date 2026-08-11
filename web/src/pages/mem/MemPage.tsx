// ── 记忆复习页 v2 ──
// 全新布局设计：全局头 + 上下文条 + 过滤 + 沉浸式卡片区
// 业务逻辑全部复用 useMemReview，此处只做组合与交互增强

import { getUpcomingCountsE, type UpcomingCounts } from "@entities/mem";
import { openAiSettings } from "@features/ai-setting";
import styles from "@pages/mem/MemPage.module.css";
import { useMemReview } from "@pages/mem/model/useMemReview.ts";
import ContextBar from "@pages/mem/ui/ContextBar.tsx";
import FilterBar from "@pages/mem/ui/FilterBar.tsx";
import MnemonicSettingsModal from "@pages/mem/ui/MnemonicSettingsModal.tsx";
import ReviewCard from "@pages/mem/ui/ReviewCard.tsx";
import Sidebar from "@pages/mem/ui/Sidebar.tsx";
import { notifyError, tryAsync } from "@shared/lib";
import { A } from "@solidjs/router";
import {
	createDeferred,
	createResource,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js";

export default function MemPage() {
	const m = useMemReview();
	const [showMnemonicSettings, setShowMnemonicSettings] = createSignal(false);

	// 8h/24h 待复习统计：评分会连续改变 due.length，用 createDeferred 合并 + 60s 缓存降频
	const UPCOMING_TTL = 60_000;
	let lastUpcomingAt = 0;
	let lastUpcoming: UpcomingCounts | null = null;
	const dueLen = createDeferred(() => m.due().length);
	const [upcomingCounts] = createResource(
		() => dueLen(),
		async () => {
			if (lastUpcoming && Date.now() - lastUpcomingAt < UPCOMING_TTL)
				return lastUpcoming;
			const result = await tryAsync(() => getUpcomingCountsE());
			if (result.ok) {
				lastUpcoming = result.value;
				lastUpcomingAt = Date.now();
				return result.value;
			}
			notifyError("获取待复习统计失败", result.error);
			return { within_8h: 0, within_24h: 0 };
		},
	);

	// ── 队列导航：键盘 ←/→（不干扰空格翻面与 1-4 评分） ──
	const nav = (dir: -1 | 1) => {
		const next = Math.min(
			Math.max(0, m.current() + dir),
			Math.max(0, m.due().length - 1),
		);
		m.setCurrent(next);
		m.setShowAnswer(false);
	};
	const onKey = (e: KeyboardEvent) => {
		if (
			e.target instanceof HTMLTextAreaElement ||
			(e.target as HTMLElement)?.tagName === "INPUT"
		)
			return;
		if (e.key === "ArrowLeft") nav(-1);
		else if (e.key === "ArrowRight") nav(1);
	};
	onMount(() => globalThis.addEventListener("keydown", onKey));
	onCleanup(() => globalThis.removeEventListener("keydown", onKey));

	return (
		<div class={styles.page}>
			<Sidebar m={m} />

			<div class={styles.main}>
				{/* 全局头：只留导航 */}
				<div class={styles.topBar}>
					<button
						type="button"
						class={styles.hamburger}
						onClick={() => m.setSidebarOpen(!m.sidebarOpen())}
					>
						☰
					</button>
					<span class={styles.title}>记忆复习</span>
					<div class={styles.topRight}>
						<button
							type="button"
							class={styles.iconBtn}
							onClick={() => setShowMnemonicSettings(true)}
							title="助记提示词设置"
						>
							🧠
						</button>
						<button
							type="button"
							class={styles.iconBtn}
							onClick={openAiSettings}
							title="AI 设置"
						>
							🤖
						</button>
						<A href="/m/add" class={styles.addLink}>
							＋ 添加
						</A>
						<A href="/m/manage" class={styles.manageLink}>
							管理
						</A>
					</div>
				</div>

				{/* 上下文条：统计 + 编辑 */}
				<ContextBar m={m} upcomingCounts={upcomingCounts()} />

				{/* 过滤 */}
				<FilterBar m={m} />

				{/* 卡片区 */}
				<div class={styles.cardArea}>
					<ReviewCard m={m} />
				</div>
			</div>

			<MnemonicSettingsModal
				isOpen={showMnemonicSettings()}
				onClose={() => setShowMnemonicSettings(false)}
			/>
		</div>
	);
}
