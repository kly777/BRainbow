import { AsyncView } from "@components/ui/molecules/AsyncView.tsx";
import PageHead from "@components/ui/molecules/PageHead.tsx";
import { type JSX, Show } from "solid-js";

export interface ListPageProps<T> {
	/** 页面标题（由 PageHead 渲染为唯一的 <h1>） */
	title: string;
	/** 标题下的说明文字 */
	desc?: string;
	/** 页头右侧动作区（新建按钮等） */
	actions?: JSX.Element;
	/** 页头与列表之间的筛选/工具条；外层已提供 flex + wrap + gap */
	filters?: JSX.Element;
	/** 列表下方（统计、说明等），同样原样渲染 */
	footer?: JSX.Element;
	/**
	 * 页面容器的类。**宽度与内边距刻意由调用方提供** —— 各页的容器宽度
	 * 用的是不同令牌（--page-max / --page-text-max 等），外壳强加一套
	 * 会改变现有版式，因此这里只做结构组合。
	 */
	class?: string;

	// ── 四态数据（原样透传给 AsyncView） ──
	data: readonly T[] | null | undefined;
	loading?: boolean;
	error?: unknown;
	onRetry?: () => void;
	emptyMessage?: string;
	emptySlot?: JSX.Element;
	/** 加载骨架形状（网格布局的页面传 "grid"；原样透传给 AsyncView） */
	loadingVariant?: "list" | "grid";

	/** 渲染函数接收 accessor；详见 AsyncView 的说明（避免刷新时重建子树） */
	children: (data: () => readonly T[]) => JSX.Element;
}

/**
 * 列表页外壳：把"页头 + 筛选区 + 四态列表 + 页脚"这套每个列表页都要重写
 * 一遍的组合收成一处。
 *
 * 动机：改造前 33 个页面里只有 9 个用统一页头、8 个接四态视图，其余各写各的，
 * 于是出现"同一件事三种写法"与页面结构不一致（含 4 个页面整页没有一级标题）。
 * 外壳把两件正确的默认行为固定下来：**页头必有唯一 h1**、**列表必接四态**。
 * 它刻意只管结构、不管视觉：容器宽度与筛选区布局一律由调用方给，
 * 因此把已有页面迁进来不会改变外观。
 *
 * 泛型 T 与 AsyncView 一致；`children` 收 accessor 而非快照数组，故数据刷新
 * 由调用方内部的 <For> 做行级 diff，不会整棵重建（输入框焦点得以保持）。
 */
export default function ListPage<T>(props: ListPageProps<T>) {
	return (
		<div class={props.class}>
			<PageHead title={props.title} desc={props.desc} actions={props.actions} />

			<Show when={props.filters}>{props.filters}</Show>

			<AsyncView
				data={props.data}
				loading={props.loading}
				error={props.error}
				onRetry={props.onRetry}
				emptyMessage={props.emptyMessage}
				emptySlot={props.emptySlot}
				loadingVariant={props.loadingVariant}
			>
				{props.children}
			</AsyncView>

			<Show when={props.footer}>{props.footer}</Show>
		</div>
	);
}
