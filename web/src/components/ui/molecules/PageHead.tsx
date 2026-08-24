import { type JSX, Show } from "solid-js";
import styles from "./PageHead.module.css";

/** Workbench 族页头：display 标题 + 弱化说明 + 右侧动作区（design.md 宏观结构契约） */
export default function PageHead(props: {
	title: string;
	desc?: string;
	actions?: JSX.Element;
}) {
	return (
		<header class={styles.head}>
			<div class={styles.text}>
				<h1 class={styles.title}>{props.title}</h1>
				<Show when={props.desc}>
					<p class={styles.desc}>{props.desc}</p>
				</Show>
			</div>
			<Show when={props.actions}>
				<div class={styles.actions}>{props.actions}</div>
			</Show>
		</header>
	);
}
