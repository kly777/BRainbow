// 文章卡片（从 ReadingList.tsx 下钻；认识的百分比与分档口径见 ../lib/reading-stats.ts）

import { fillPath, PATHS } from "@config/paths";
import { fmtLocal } from "@shared/utils";
import { A } from "@solidjs/router";
import type { Component } from "solid-js";
import type { ArticleSummary } from "../api.ts";
import { knownLevel, knownPercent } from "../lib/reading-stats.ts";
import styles from "../ReadingList.module.css";

export interface ArticleCardProps {
	article: ArticleSummary;
	/** 推荐先读（列表第一张） */
	first: boolean;
}

const ArticleCard: Component<ArticleCardProps> = (props) => (
	<A
		href={fillPath(PATHS.readingDetail, props.article.id)}
		class={styles.card}
		classList={{
			[styles.recommendedCard]: props.first,
		}}
		data-known={knownLevel(props.article.known_ratio)}
	>
		<div class={styles.cardTitleRow}>
			<div class={styles.cardTitle}>{props.article.title}</div>
			{props.first && <span class={styles.recommendedTag}>推荐先读</span>}
		</div>
		<div class={styles.cardMeta}>
			<span>{props.article.word_count} 词</span>
			<span
				class={styles.ratio}
				data-known={knownLevel(props.article.known_ratio)}
			>
				{knownPercent(props.article.known_ratio)}% 认识
			</span>
			<span class={styles.unknownCount}>
				{props.article.unknown_word_count} 个不认识
			</span>
			<span class={styles.createdAt}>{fmtLocal(props.article.created_at)}</span>
		</div>
		<div class={styles.barOuter}>
			<div
				class={styles.barInner}
				style={{ width: `${knownPercent(props.article.known_ratio)}%` }}
			/>
		</div>
	</A>
);

export default ArticleCard;
