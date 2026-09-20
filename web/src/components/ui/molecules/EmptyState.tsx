import { type JSX, Show } from "solid-js";
import styles from "./EmptyState.module.css";

interface Props {
	/** 主文案（一句话说清"这里为什么是空的"） */
	title?: string;
	/** 次文案：引导下一步怎么做（可含链接） */
	hint?: JSX.Element;
	/** 主文案上方的图标 */
	icon?: JSX.Element;
	/** 底部的行动入口（按钮 / 链接） */
	action?: JSX.Element;
	/** 紧凑变体：面板内、表格单元格等单行场景 */
	compact?: boolean;
	class?: string;
	children?: JSX.Element;
}

/**
 * 空态：告诉用户"这里没有内容"以及"接下来能做什么"。
 *
 * 动机与 `AsyncView` / `ListPage` 同源 —— 空态此前在二十多个地方各写一份
 * （`<div class={styles.empty}>暂无数据</div>` 之类），文案层级、内边距、字号
 * 各不相同，也没有统一的"动作入口"位置。`AsyncView` 的 `emptyMessage` 只覆盖
 * 纯文案那一档，插槽本身又不带样式。
 *
 * 只做结构与排版，不做业务判断：**是不是空、空态说什么**由调用方决定
 * （"筛选无结果"与"首次进入"的两种文案归调用方），所以没有 `filtered` 之类的
 * 语义参数 —— 那是 `EmptyGuide` 那种领域组件的职责。
 */
export default function EmptyState(props: Props) {
	return (
		<div
			classList={{ [styles.empty]: true, [styles.compact]: props.compact }}
			class={props.class}
		>
			<Show when={props.icon}>
				<span class={styles.icon}>{props.icon}</span>
			</Show>
			<Show when={props.title}>
				<p class={styles.title}>{props.title}</p>
			</Show>
			<Show when={props.hint}>
				<p class={styles.hint}>{props.hint}</p>
			</Show>
			{props.children}
			<Show when={props.action}>
				<div class={styles.action}>{props.action}</div>
			</Show>
		</div>
	);
}
