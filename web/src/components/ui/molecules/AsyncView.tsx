import Button from "@components/ui/atoms/Button.tsx";
import styles from "@components/ui/molecules/AsyncView.module.css";
import { getErrorMessage } from "@shared/api/types/index.ts";
import { type JSX, Show, untrack } from "solid-js";

interface Props<T> {
	data: readonly T[] | null | undefined;
	loading?: boolean;
	error?: unknown;
	onRetry?: () => void;
	emptyMessage?: string;
	/** 自定义空态（传了就不显示 emptyMessage 文案） */
	emptySlot?: JSX.Element;
	/**
	 * 加载骨架的形状，默认列表行。网格布局（卡片墙）要传 "grid" ——
	 * 否则加载时是一列横条、加载完变成一片卡片，切换瞬间版式会跳。
	 */
	loadingVariant?: "list" | "grid";
	/**
	 * children 接收 accessor 而非快照数组：子树只在四态切换时挂载一次，
	 * 数据刷新由调用方内部的表达式（如 <For each={data()}>）做行级 diff，
	 * 不再整棵重建——输入框焦点/DOM 身份因此跨刷新保持。
	 */
	children: (data: () => readonly T[]) => JSX.Element;
}

const EMPTY: readonly unknown[] = [];

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

/** 网格骨架：缩略图块按卡片的比例与列宽排布（列宽跟着调用方的网格走） */
function GridSkeletonLoader() {
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

export function AsyncView<T>(props: Props<T>) {
	return (
		<Show
			when={!props.loading}
			fallback={
				props.loadingVariant === "grid" ? (
					<GridSkeletonLoader />
				) : (
					<SkeletonLoader />
				)
			}
		>
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
						props.emptySlot ?? (
							<div class={styles.state}>{props.emptyMessage || "暂无数据"}</div>
						)
					}
				>
					{/* untrack：children 只在此分支挂载时求值一次；
					    后续数据读取经由传入的 accessor 在调用方的响应式作用域内发生 */}
					{untrack(() =>
						props.children(() => (props.data ?? EMPTY) as readonly T[]),
					)}
				</Show>
			</Show>
		</Show>
	);
}
