// ── v2 侧栏：学习池队列 + 状态图例 ──

import { createEffect, For, Show } from "solid-js";
import type { UseMemReview } from "../../logic/useMemReview.ts";
import * as styles from "./V2Sidebar.css.ts";

interface V2SidebarProps {
	m: UseMemReview;
}

const stateLabel: Record<string, string> = {
	new: "新",
	learning: "学",
	relearning: "重",
	review: "复",
};

export default function V2Sidebar(props: V2SidebarProps) {
	const { m } = props;

	// 当前卡自动滚动到可见
	let listRef: HTMLDivElement | undefined;
	createEffect(() => {
		const active = listRef?.querySelector(`[data-active="true"]`);
		active?.scrollIntoView({ block: "nearest" });
	});

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
					✕
				</button>
			</div>

			{/* 状态图例 */}
			<Show when={m.counts()}>
				{(c) => (
					<div class={styles.legend}>
						<span class={styles.legendItem}>
							<i class={`${styles.dot} ${styles.dotNew}`} />新 {c().new}
						</span>
						<span class={styles.legendItem}>
							<i class={`${styles.dot} ${styles.dotLearning}`} />学{" "}
							{c().learning}
						</span>
						<span class={styles.legendItem}>
							<i class={`${styles.dot} ${styles.dotReview}`} />复 {c().due}
						</span>
						<span class={styles.legendItem}>
							<i class={`${styles.dot} ${styles.dotBuried}`} />埋{" "}
							{c().buried}
						</span>
						<span class={styles.legendItem}>
							<i class={`${styles.dot} ${styles.dotSuspended}`} />挂{" "}
							{c().suspended}
						</span>
					</div>
				)}
			</Show>

			{/* 队列列表 */}
			<div class={styles.sidebarList} ref={listRef}>
				<For each={m.due()}>
					{(mem, i) => (
						<button
							type="button"
							class={styles.sidebarItem}
							classList={{ [styles.sidebarActive]: i() === m.current() }}
							data-active={i() === m.current()}
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
