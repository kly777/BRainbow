import Toolbar from "@components/ui/molecules/Toolbar.tsx";
import styles from "@components/ui/organisms/DetailPage.module.css";
import { type JSX, Show } from "solid-js";

export interface DetailPageProps {
	/** 页面标题，渲染为唯一的 <h1> */
	title: string;
	/** 返回按钮文案 */
	backLabel: string;
	onBack: () => void;
	/** 返回栏右侧动作（编辑 / 删除等） */
	actions?: JSX.Element;
	/**
	 * 页面别处已显著展示同一标题时置 true —— h1 改为仅供读屏器。
	 * 用于"标题即内容"的页面（如文本编辑器），避免视觉上重复一遍。
	 */
	titleHidden?: boolean;
	/** 页面容器类；宽度与内边距同样由调用方提供（各页用的令牌不同） */
	class?: string;
	children: JSX.Element;
}

/**
 * 详情页外壳：返回栏 + 页标题 + 动作区 + 内容。
 *
 * 与 ListPage 同样的动机：详情页此前各写各的返回栏，且**整页没有一级标题**
 * 是常见状态（改造前 db / rainbow / text / file 四页均无 h1）—— 标题层级
 * 缺失既影响读屏器导航，也让 document outline 断裂。外壳把 h1 固定下来。
 *
 * `titleHidden` 提供给"标题已在内容中显著呈现"的页面（文本编辑器等），
 * 此时 h1 用 sr-only，既补齐语义又不重复显示。
 */
export default function DetailPage(props: DetailPageProps) {
	return (
		<div class={props.class}>
			<Toolbar backLabel={props.backLabel} onBack={props.onBack}>
				{props.actions}
			</Toolbar>

			<Show
				when={!props.titleHidden}
				fallback={<h1 class="sr-only">{props.title}</h1>}
			>
				<h1 class={styles.title}>{props.title}</h1>
			</Show>

			{props.children}
		</div>
	);
}
