import { Show, type JSX } from "solid-js";
import { getErrorMessage } from "../../apis/types/index.ts";
import styles from "./AsyncView.module.css";

interface Props<T> {
	data: readonly T[] | null | undefined;
	loading?: boolean;
	error?: unknown;
	onRetry?: () => void;
	emptyMessage?: string;
	children: (data: readonly T[]) => JSX.Element;
}

export function AsyncView<T>(props: Props<T>) {
	return (
		<Show when={!props.loading} fallback={<div class={styles.state}>加载中...</div>}>
			<Show when={!props.error} fallback={
				<div class={styles.state}>
					<p class={styles.errorText}>加载失败: {getErrorMessage(props.error)}</p>
					{props.onRetry && <button type="button" class={styles.retryBtn} onClick={props.onRetry}>重试</button>}
				</div>
			}>
				<Show when={(props.data?.length ?? 0) > 0} fallback={
					<div class={styles.state}>{props.emptyMessage || "暂无数据"}</div>
				}>
					{props.children(props.data ?? [])}
				</Show>
			</Show>
		</Show>
	);
}
