import styles from "./Skeleton.module.css";

/** Simple loading skeleton placeholder — replaces plain text "加载中…" */
export function LoadingSkeleton(props: { rows?: number }) {
	const rows = () => props.rows ?? 3;
	return (
		<div class={styles.skeletonWrap} aria-label="加载中" role="status">
			{Array.from({ length: rows() }, (_, i) => (
				<div class={styles.skeletonRow}>
					<div
						class={`skeleton ${styles.skeletonBar}`}
						style={{ width: `${70 - i * 12}%` }}
					/>
				</div>
			))}
		</div>
	);
}

/**
 * 列表骨架：三行"缩略块 + 横条"（第 4 行只有一条短横条）。
 * `AsyncView` 的 `loadingVariant="list"` 用它；`aria-hidden` 是因为
 * 四态视图自身已在状态切换处交代了"加载中"，重复播报反而吵。
 */
export function SkeletonList() {
	return (
		<div class={styles.skeletonListWrap} aria-hidden="true">
			{[1, 2, 3].map((i) => (
				<div class={styles.skeletonListRow}>
					<div class={`skeleton ${styles.skeletonListAvatar}`} />
					<div
						class={`skeleton ${styles.skeletonListBar}`}
						style={{ width: `${70 - i * 10}%` }}
					/>
				</div>
			))}
			<div class={styles.skeletonListRow}>
				<div
					class={`skeleton ${styles.skeletonListBar} ${styles.skeletonListBarShort}`}
				/>
			</div>
		</div>
	);
}

/**
 * 网格骨架：缩略图块按卡片的比例与列宽排布（列宽跟着调用方的网格走），
 * 用于卡片墙（`AsyncView` 的 `loadingVariant="grid"`）——加载完不跳版式。
 */
export function SkeletonGrid() {
	return (
		<div class={styles.skeletonGrid} aria-hidden="true">
			{[1, 2, 3, 4, 5, 6, 7, 8].map(() => (
				<div class={styles.skeletonCard}>
					<div class={`skeleton ${styles.skeletonCardThumb}`} />
					<div class={`skeleton ${styles.skeletonCardName}`} />
					<div class={`skeleton ${styles.skeletonCardMeta}`} />
				</div>
			))}
		</div>
	);
}
