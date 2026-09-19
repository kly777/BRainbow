import { LoadingSkeleton } from "@components/ui/atoms/Skeleton.tsx";
import ErrorRetry from "@components/ui/molecules/ErrorRetry.tsx";
import { type Accessor, type JSX, Show } from "solid-js";

interface Props<T> {
	/** 数据（详情页通常是 useDetailResource 的 data） */
	data: Accessor<T | undefined>;
	/** 还没有数据 —— 只有它为真时渲染骨架 */
	loading: Accessor<boolean>;
	error: Accessor<unknown>;
	onRetry: () => void;
	/** 有数据、正在后台更新：给内容容器加 aria-busy（布局不动，样式由调用方决定） */
	refreshing?: Accessor<boolean>;
	/** 没数据也没错误时的文案（默认"暂无数据"） */
	emptyMessage?: string;
	/** 自定义骨架（如整块预览区） */
	skeleton?: JSX.Element;
	/**
	 * 内容容器类。**互斥渲染发生在这里**：错误 / 骨架 / 空 / 内容四选一，
	 * 所以不可能再出现"骨架与旧内容同框"（/file/:id 的"沉一下"）。
	 */
	class?: string;
	/** 内联 style：详情页用它把两栏宽度写成自定义属性（--side-width） */
	style?: string;
	/** 内容；收 accessor 而不是快照，避免把值读死 */
	children: (data: Accessor<T>) => JSX.Element;
}

/**
 * 详情页的异步状态渲染：错误 + 重试 / 骨架 / 空 / 内容，四选一。
 *
 * 与 `AsyncView` 的分工：那个是**列表**外壳（`data: readonly T[]`、空态按 length 判断、
 * children 收数组 accessor）；这里是**单个实体**，用于详情页。
 *
 * 判断顺序刻意是 **error → loading → empty → data**（与 `AsyncView` 的 loading 优先相反）：
 * 错误是终态信息，一旦拿到就不该再被骨架屏挡住 —— 那正是 P1-5"页面永远停在骨架屏"的形状。
 * 顺序写进原语，调用方即使把状态接错也顶多是少个骨架，不会丢错误。
 *
 * `refreshing` 的语义是"有旧数据、正在更新"（见 useDetailResource）：
 * 此时保留内容、只标 `aria-busy`，绝不能再插一块骨架 —— 那会把内容顶下去。
 */
export function AsyncSection<T>(props: Props<T>) {
	const content = () => props.data() as T;
	return (
		<Show
			when={!props.error()}
			fallback={<ErrorRetry error={props.error()} onRetry={props.onRetry} />}
		>
			<Show
				when={!props.loading()}
				fallback={props.skeleton ?? <LoadingSkeleton />}
			>
				<Show
					when={props.data() !== undefined && props.data() !== null}
					fallback={
						<div class={props.class} style={props.style}>
							{props.emptyMessage ?? "暂无数据"}
						</div>
					}
				>
					<div
						class={props.class}
						style={props.style}
						aria-busy={props.refreshing?.() ? "true" : undefined}
					>
						{props.children(content)}
					</div>
				</Show>
			</Show>
		</Show>
	);
}
