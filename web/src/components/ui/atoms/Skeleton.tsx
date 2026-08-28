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
