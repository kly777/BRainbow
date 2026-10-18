import type { JSX } from "solid-js";
import styles from "./SplitWorkspace.module.css";

export interface SplitWorkspaceProps {
	main: JSX.Element;
	side: JSX.Element;
	class?: string;
}

/** 工作台双栏：主内容 + 上下文（列表 + 日历/详情）。窄屏自动上下堆叠。 */
export default function SplitWorkspace(props: SplitWorkspaceProps) {
	return (
		<div class={`${styles.split}${props.class ? ` ${props.class}` : ""}`}>
			<div class={styles.main}>{props.main}</div>
			<div class={styles.side}>{props.side}</div>
		</div>
	);
}
