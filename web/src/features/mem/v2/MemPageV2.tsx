// ── 记忆复习页 v2 ──
// 全新布局设计：全局头 + 上下文条 + 过滤 + 沉浸式卡片区
// 业务逻辑全部复用 useMemReview，此处只做组合与交互增强

import { A } from "@solidjs/router";
import { createResource, createSignal, onCleanup, onMount, Show } from "solid-js";
import { getUpcomingCountsE } from "../api.ts";
import { useMemReview } from "../logic/useMemReview.ts";
import { notifyError } from "../../../lib/notify.ts";
import { tryAsync } from "../../../lib/result.ts";
import styles from "./MemPageV2.module.css";
import "./tokens.css";
import AiSettingsModal from "../ui/AiSettingsModal.tsx";
import V2ContextBar from "./ui/V2ContextBar.tsx";
import V2FilterBar from "./ui/V2FilterBar.tsx";
import V2ReviewCard from "./ui/V2ReviewCard.tsx";
import V2Sidebar from "./ui/V2Sidebar.tsx";

export default function MemPageV2() {
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
			<V2Sidebar m={m} />

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
				<V2ContextBar m={m} upcomingCounts={upcomingCounts()} />

				{/* 过滤 */}
				<V2FilterBar m={m} />

				{/* 卡片区 */}
				<div class={styles.cardArea}>
					<V2ReviewCard m={m} />
				</div>
			</div>

			<AiSettingsModal
				isOpen={showAiSettings()}
				onClose={() => setShowAiSettings(false)}
			/>
		</div>
	);
}
