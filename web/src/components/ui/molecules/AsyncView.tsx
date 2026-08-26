import Button from "@components/ui/atoms/Button.tsx";
import styles from "@components/ui/molecules/AsyncView.module.css";
import { getErrorMessage } from "@lib/api/types/index.ts";
import { type JSX, Show } from "solid-js";

interface Props<T> {
	data: readonly T[] | null | undefined;
	loading?: boolean;
	error?: unknown;
	onRetry?: () => void;
	emptyMessage?: string;
	children: (data: readonly T[]) => JSX.Element;
}

function SkeletonLoader() {
	return (
		<div class={styles.skeletonWrap} aria-hidden="true">
			{[1, 2, 3].map((i) => (
				<div class={styles.skeletonRow}>
					<div class={`skeleton ${styles.skeletonAvatar}`} />
					<div
						class={`skeleton ${styles.skeletonBar}`}
						style={{ width: `${70 - i * 10}%` }}
					/>
				</div>
			))}
			<div class={styles.skeletonRow}>
				<div
					class={`skeleton ${styles.skeletonBar} ${styles.skeletonBarShort}`}
				/>
			</div>
		</div>
	);
}

export function AsyncView<T>(props: Props<T>) {
	return (
		<Show when={!props.loading} fallback={<SkeletonLoader />}>
			<Show
				when={!props.error}
				fallback={
					<div class={styles.state}>
						<p class={styles.errorText}>
							加载失败: {getErrorMessage(props.error)}
						</p>
						{props.onRetry && (
							<Button variant="primary" size="sm" onClick={props.onRetry}>
								重试
							</Button>
						)}
					</div>
				}
			>
				<Show
					when={(props.data?.length ?? 0) > 0}
					fallback={
						<div class={styles.state}>{props.emptyMessage || "暂无数据"}</div>
					}
				>
					{props.children(props.data ?? [])}
				</Show>
			</Show>
		</Show>
	);
}
