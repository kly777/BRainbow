import { Show, type JSX } from "solid-js";
import styles from "./Panel.module.css";

export interface PanelProps {
	title?: string;
	hint?: string;
	actions?: JSX.Element;
	/** 固定在头部与滚动内容之间的工具条（筛选、范围切换等） */
	toolbar?: JSX.Element;
	children: JSX.Element;
	/** 撑满父容器，用于首页两栏 */
	fill?: boolean;
	scroll?: boolean;
	class?: string;
}

/** 页面级面板：统一表面、头部、工具条与滚动体。 */
export default function Panel(props: PanelProps) {
	return (
		<section
			class={`${styles.panel}${props.fill ? ` ${styles.fill}` : ""}${props.class ? ` ${props.class}` : ""}`}
		>
			<Show when={props.title || props.hint || props.actions}>
				<header class={styles.head}>
					<div class={styles.headText}>
						<Show when={props.title}>
							<h2 class={styles.title}>{props.title}</h2>
						</Show>
						<Show when={props.hint}>
							<p class={styles.hint}>{props.hint}</p>
						</Show>
					</div>
					<Show when={props.actions}>
						<div class={styles.actions}>{props.actions}</div>
					</Show>
				</header>
			</Show>
			<Show when={props.toolbar}>
				<div class={styles.toolbar}>{props.toolbar}</div>
			</Show>
			<div
				class={styles.body}
				classList={{ [styles.scroll]: props.scroll === true }}
			>
				{props.children}
			</div>
		</section>
	);
}
