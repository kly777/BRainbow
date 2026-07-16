// ── 记忆复习页面 ──
// 薄壳视图层：渲染逻辑全部来自 useMemReview hook

import { A } from "@solidjs/router";
import { Show, createSignal } from "solid-js";
import { useMemReview } from "./logic/useMemReview.ts";
import MemSidebar from "./ui/MemSidebar.tsx";
import MemTagFilterBar from "./ui/MemTagFilterBar.tsx";
import MemReviewCard from "./ui/MemReviewCard.tsx";
import AiSettingsModal from "./ui/AiSettingsModal.tsx";
import styles from "./MemPage.module.css";

export default function MemPage() {
	const m = useMemReview();
	const [showAiSettings, setShowAiSettings] = createSignal(false);

	return (
		<div class={styles.page}>
			<MemSidebar m={m} />

			<div class={styles.main}>
				{/* 顶栏 */}
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
							class={styles.editLinkBtn}
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

						<Show
							when={m.editing()}
							fallback={
								<button
									type="button"
									class={styles.editLinkBtn}
									onClick={m.startEdit}
								>
									编辑
								</button>
							}
						>
							<button
								type="button"
								class={styles.editLinkBtn}
								onClick={m.saveEdit}
							>
								保存
							</button>
							<button
								type="button"
								class={styles.editLinkBtn}
								onClick={() => m.setEditing(false)}
							>
								取消
							</button>
						</Show>
						<span class={styles.count}>
							{m.due().length}/{m.maxLearning()}
						</span>
					</div>
				</div>

				<MemTagFilterBar m={m} />
				<MemReviewCard m={m} />
			</div>

			<AiSettingsModal
				isOpen={showAiSettings()}
				onClose={() => setShowAiSettings(false)}
			/>
		</div>
	);
}
