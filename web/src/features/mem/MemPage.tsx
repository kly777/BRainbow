// ── 记忆复习页 v2 ──
// 全新布局设计：全局头 + 上下文条 + 过滤 + 沉浸式卡片区
// 业务逻辑全部复用 useMemReview，此处只做组合与交互增强

import { A } from "@solidjs/router";
import { createResource, createSignal, onCleanup, onMount, Show } from "solid-js";
import { getUpcomingCountsE } from "@features/mem/api.ts";
import { useMemReview } from "@features/mem/logic/useMemReview.ts";
import { notifyError } from "@lib/notify.ts";
import { tryAsync } from "@lib/result.ts";
import * as styles from "@features/mem/MemPage.css.ts";
import AiSettingsModal from "@features/mem/ui/AiSettingsModal.tsx";
import ContextBar from "@features/mem/ui/ContextBar.tsx";
import FilterBar from "@features/mem/ui/FilterBar.tsx";
import ReviewCard from "@features/mem/ui/ReviewCard.tsx";
import Sidebar from "@features/mem/ui/Sidebar.tsx";

export default function MemPage() {
	const m = useMemReview();
	const [showAiSettings, setShowAiSettings] = createSignal(false);

	const [upcomingCounts] = createResource(
		() => m.due().length,
		async () => {
			const result = await tryAsync(() => getUpcomingCountsE());
			if (result.ok) return result.value;
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
							onClick={() => setShowAiSettings(true)}
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

			<AiSettingsModal
				isOpen={showAiSettings()}
				onClose={() => setShowAiSettings(false)}
			/>
		</div>
	);
}
