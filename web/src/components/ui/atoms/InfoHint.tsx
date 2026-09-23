import { Info } from "@components/ui/icons";
import type { JSX } from "solid-js";
import styles from "./InfoHint.module.css";
import Tooltip from "./Tooltip.tsx";

interface InfoHintProps {
	/** 悬浮 / 聚焦时显示的解释文字（可以多段） */
	children: JSX.Element;
	/**
	 * 触发图标的无障碍名称（读屏器念到的那句话），例如"关于服务器信息的说明"。
	 * 必填：光有一个 ⓘ 图标，读屏器无从知道它是什么。
	 */
	label: string;
	position?: "top" | "bottom" | "left" | "right";
}

/**
 * 「需要时才看」的解释文字：一个 ⓘ 图标，悬浮或键盘聚焦时用气泡展开内容。
 *
 * 为什么有它：页面里那些"数据都在同一块盘上""没配备份目录时是 —"的说明一直挂在
 * 界面上，会把真正要看的状态淹没。收进气泡后界面只剩状态本身；想知道来龙去脉的人
 * hover 一下、键盘用户 Tab 一下就有。
 *
 * 交互与无障碍全部复用 `Tooltip`（Portal 到 body 不受 overflow 裁剪、
 * `role="tooltip"` + `aria-describedby`、悬浮与 focus 都显示），本组件只负责
 * 把触发图标做成一个**按钮**：原生可聚焦、读屏器会念出 label，点一下（触屏没有
 * hover）也能展开。
 */
export default function InfoHint(props: InfoHintProps) {
	return (
		<Tooltip content={props.children} position={props.position ?? "top"}>
			<button type="button" class={styles.trigger} aria-label={props.label}>
				<Info size={14} aria-hidden="true" />
			</button>
		</Tooltip>
	);
}
