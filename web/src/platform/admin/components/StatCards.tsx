// 数据统计卡片（含 9 条内联 SVG path 的图标表）——从 AdminPage.tsx 下钻，
// 页面只剩取数与装配。图标路径与后端 ModuleStats 的键一一对应。

import { Button } from "@components/ui";
import { For } from "solid-js";
import styles from "../AdminPage.module.css";
import type { ModuleStats } from "../api.ts";
import { getStatValue } from "../utils.ts";

export interface StatCardsProps {
	stats: ModuleStats;
	onRefresh: () => void;
}

const STAT_ITEMS: { key: keyof ModuleStats; label: string; icon: string }[] = [
	{
		key: "users",
		label: "用户",
		icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
	},
	{
		key: "tasks",
		label: "任务",
		icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
	},
	{
		key: "cards",
		label: "卡片",
		icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
	},
	{
		key: "memories",
		label: "记忆",
		icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
	},
	{
		key: "bookmarks",
		label: "书签",
		icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z",
	},
	{
		key: "articles",
		label: "文章",
		icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
	},
	{
		key: "conversations",
		label: "对话",
		icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
	},
	{
		key: "chat_trees",
		label: "AI 对话",
		icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
	},
	{
		key: "ontologies",
		label: "本体",
		icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
	},
];

export default function StatCards(props: StatCardsProps) {
	return (
		<section class={styles.card}>
			<div class={styles.cardHead}>
				<h2 class={styles.cardTitle}>数据统计</h2>
				<Button variant="ghost" size="sm" onClick={props.onRefresh}>
					刷新
				</Button>
			</div>
			<div class={styles.statsGrid}>
				<For each={STAT_ITEMS}>
					{(item) => (
						<div class={styles.statItem}>
							<div class={styles.statIcon}>
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d={item.icon} />
								</svg>
							</div>
							<div class={styles.statBody}>
								<span class={styles.statValue}>
									{getStatValue(props.stats, item.key)}
								</span>
								<span class={styles.statLabel}>{item.label}</span>
							</div>
						</div>
					)}
				</For>
			</div>
		</section>
	);
}
