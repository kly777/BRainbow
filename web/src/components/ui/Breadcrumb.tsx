import { A } from "@solidjs/router";
import { For } from "solid-js";
import styles from "./Breadcrumb.module.css";

export interface Crumb {
	label: string;
	href?: string;
}

/** 面包屑导航：首页 > 卡片 > 详情 */
export default function Breadcrumb(props: { items: readonly Crumb[] }) {
	return (
		<nav class={styles.breadcrumb} aria-label="面包屑导航">
			<For each={props.items}>
				{(item, i) => {
					const isLast = i() === props.items.length - 1;
					return (
						<>
							{item.href ? (
								<A href={item.href} class={styles.link}>
									{item.label}
								</A>
							) : (
								<span class={styles.current}>{item.label}</span>
							)}
							{!isLast && <span class={styles.sep}>›</span>}
						</>
					);
				}}
			</For>
		</nav>
	);
}
