import { A } from "@solidjs/router";
import { typeLabel } from "@features/conv/logic/constants.ts";
import styles from "@features/conv/ConvDetail.module.css";

interface Props {
	title: string;
	type: string;
	date?: string;
	backHref: string;
}

/** 详情页顶部导航栏：返回链接 + 标题 + 类型标签 + 日期 */
export default function ConvTopBar(props: Props) {
	return (
		<div class={styles.topBar}>
			<A href={props.backHref} class={styles.backLink}>
				← 搜索
			</A>
			<div class={styles.titleArea}>
				<h1 class={styles.title}>{props.title}</h1>
				<span class={styles.tag}>{typeLabel[props.type] || props.type}</span>
				{props.date && <span class={styles.date}>{props.date}</span>}
			</div>
		</div>
	);
}
