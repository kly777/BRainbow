import type { JSX } from "solid-js";
import styles from "./PageFrame.module.css";

export interface PageFrameProps {
	header?: JSX.Element;
	/** 固定在正文上方的一条工具带（搜索、筛选等） */
	toolbar?: JSX.Element;
	children: JSX.Element;
	class?: string;
	/** 底部有固定命令条/工具条时预留空间 */
	reserveBottom?: boolean;
}

/** 页面级骨架：header / toolbar / 占满剩余高度 body。 */
export default function PageFrame(props: PageFrameProps) {
	return (
		<div
			class={`${styles.frame}${props.reserveBottom ? ` ${styles.reserveBottom}` : ""}${props.class ? ` ${props.class}` : ""}`}
		>
			{props.header}
			{props.toolbar}
			<div class={styles.body}>{props.children}</div>
		</div>
	);
}
