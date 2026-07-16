// ── 复习页面侧边栏 ──

import { For, Show } from "solid-js";
import type { UseMemReview } from "../logic/useMemReview.ts";
import styles from "../MemPage.module.css";

interface MemSidebarProps {
	m: UseMemReview;
}

const stateLabel: Record<string, string> = {
	new: "新",
	learning: "学",
	relearning: "重",
	review: "复",
};

export default function MemSidebar(props: MemSidebarProps) {
	const { m } = props;

	return (
		<div
			class={styles.sidebar}
			classList={{ [styles.sidebarOpen]: m.sidebarOpen() }}
		>
			<div class={styles.sidebarHeader}>
				<span>学习池</span>
				<button
					type="button"
					class={styles.sidebarClose}
					onClick={() => m.setSidebarOpen(false)}
				>
					x
				</button>
			</div>

			<Show when={m.counts()}>
				{(c) => (
					<div class={styles.sidebarStats}>
						<span class={styles.statNew}>{c().new}</span>
						<span class={styles.statLearning}>{c().learning}</span>
						<span class={styles.statDue}>{c().due}</span>
						<span class={styles.statBuried}>{c().buried}</span>
						<span class={styles.statSuspended}>{c().suspended}</span>
					</div>
				)}
			</Show>

			<div class={styles.sidebarList}>
				<For each={m.due()}>
					{(mem, i) => (
						<button
							type="button"
							class={
								i() === m.current() ? styles.sidebarActive : styles.sidebarItem
							}
							onClick={() => {
								m.setCurrent(i());
								m.setShowAnswer(false);
								m.setSidebarOpen(false);
							}}
						>
							<span class={styles.sidebarIdx}>#{mem.id}</span>
							<span class={styles.sidebarText}>
								{mem.cue.content.slice(0, 40) || "（空）"}
							</span>
							<span class={styles.sidebarState}>
								{stateLabel[mem.state] ?? mem.state}
							</span>
						</button>
					)}
				</For>
			</div>
		</div>
	);
}
