import { Button } from "@components/ui";
import { LightBulb, Menu, Sparkles } from "@components/ui/icons";
import { PATHS } from "@config/paths";
import { openAiSettings } from "@modules/ai-setting";
import { A } from "@solidjs/router";
import ContextBar from "./components/ContextBar.tsx";
import FilterBar from "./components/FilterBar.tsx";
import MnemonicSettingsModal from "./components/MnemonicSettingsModal.tsx";
import ReviewCard from "./components/ReviewCard.tsx";
import Sidebar from "./components/Sidebar.tsx";
import { useMemPage } from "./hooks/useMemPage.ts";
import styles from "./MemPage.module.css";

export default function MemPage() {
	const m = useMemPage();
	const review = m.review;

	return (
		<div class={styles.page}>
			<Sidebar m={review} />

			<div class={styles.main}>
				<div class={styles.topBar}>
					<button
						type="button"
						class={styles.hamburger}
						onClick={() => review.setSidebarOpen(!review.sidebarOpen())}
						aria-label="切换侧边栏"
					>
						<Menu size={18} />
					</button>
					<h1 class={styles.title}>记忆复习</h1>
					<div class={styles.topRight}>
						<Button
							variant="icon"
							onClick={() => m.setShowMnemonicSettings(true)}
							title="助记提示词设置"
							ariaLabel="助记提示词设置"
						>
							<LightBulb size={16} />
						</Button>
						<Button
							variant="icon"
							onClick={openAiSettings}
							title="AI 设置"
							ariaLabel="AI 设置"
						>
							<Sparkles size={16} />
						</Button>
						<A href={PATHS.memoryAdd} class={styles.addLink}>
							＋ 添加
						</A>
						<A href={PATHS.memoryManage} class={styles.manageLink}>
							管理
						</A>
					</div>
				</div>

				<ContextBar m={review} upcomingCounts={m.upcomingCounts()} />
				<FilterBar m={review} />

				<div class={styles.cardArea}>
					<ReviewCard m={review} />
				</div>
			</div>

			<MnemonicSettingsModal
				isOpen={m.showMnemonicSettings()}
				onClose={() => m.setShowMnemonicSettings(false)}
			/>
		</div>
	);
}
