// ── 等宽文本块：行号 + 换行开关 + 复制全文 ──
//
// 用于纯文本与"太大没走高亮"的代码（PlainTextViewer / CodeViewer 的退回分支）。
// 语法高亮那条路径不在这里：命中被 hljs 拆成了 span，逐行编号要另一套做法。
//
// **行号刻意不用 `<ol><li>`**：那样一行一个 DOM 节点，十万行的日志就是十万个节点，
// 而大文件恰好是这条路径最常见的输入。这里改成**一个等宽文本节点**装满行号（
// "1\n2\n3…"），与正文共用同样的行高、同一套字体 —— DOM 只有两个文本节点，
// 十万行也只是构造一个几百 KB 的字符串。
//
// 因此行号**只在"不换行"时显示**：一旦折行，一行占多行的高度，左侧编号就会错位
// （那时它会说谎，不如收起）。不换行也正是看日志/代码的默认姿势。

import { Button } from "@components/ui";
import { Copy, Type } from "@components/ui/icons";
import { copyTextWithToast } from "@shared/utils";
import { type Component, createMemo, createSignal, Show } from "solid-js";
import styles from "./viewers.module.css";

/** 超过这么多行就不生成行号串（几十万行时那段字符串本身就不划算了） */
const MAX_NUMBERED_LINES = 200_000;

/** 该文本的行数（末行没有换行符也要算一行） */
export function countLines(text: string): number {
	if (text === "") return 0;
	let lines = 1;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) lines += 1;
	}
	return lines;
}

/** 1..n 的编号串（每个占一行，与正文逐行对齐） */
export function numberingOf(lines: number): string {
	// 不用 Array.from({length}).map 生成大数组：直接拼字符串，十万行也只是一次遍历
	let out = "1";
	for (let i = 2; i <= lines; i++) out += `\n${i}`;
	return out;
}

export const PreBlock: Component<{ text: string }> = (props) => {
	const [wrap, setWrap] = createSignal(false);
	const lines = createMemo(() => countLines(props.text));
	const canNumber = () => lines() > 1 && lines() <= MAX_NUMBERED_LINES;
	const gutter = createMemo(() => (canNumber() ? numberingOf(lines()) : ""));

	return (
		<div class={styles.preBlock}>
			<div class={styles.preTools}>
				<span class={styles.preMeta}>
					{lines()} 行
					<Show when={lines() > MAX_NUMBERED_LINES}>
						（行数过多，未显示行号）
					</Show>
				</span>
				<Button
					variant="ghost"
					size="sm"
					title={wrap() ? "改为不换行（长行横向滚动）" : "改为自动换行"}
					onClick={() => setWrap((w) => !w)}
				>
					<Type size={14} /> {wrap() ? "不换行" : "自动换行"}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					title="复制全文到剪贴板"
					onClick={() => copyTextWithToast(props.text)}
				>
					<Copy size={14} /> 复制全文
				</Button>
			</div>
			<div class={styles.preBody}>
				{/* 行号：只在"不换行"时出现（折行会错位）。user-select: none 免得选中正文时带上编号 */}
				<Show when={gutter() && !wrap()}>
					<pre class={styles.preGutter} aria-hidden="true">
						{gutter()}
					</pre>
				</Show>
				<pre class={`${styles.pre} ${wrap() ? styles.preWrap : ""}`}>
					{props.text}
				</pre>
			</div>
		</div>
	);
};
