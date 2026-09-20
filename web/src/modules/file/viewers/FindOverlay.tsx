// ── 预览内的查找浮层：Ctrl/⌘+F 唤起，命中计数 + 上一个/下一个 ──
//
// 只做**一个**实现，挂在外壳上（TextContent / DocContent），于是纯文本、代码、Markdown、
// CSV、docx、epub 全都能查 —— 它们的共同点是"内容最终是 DOM 里的文本节点"（见
// lib/findInText.ts 的说明与那条跨节点限制）。
//
// 高亮用**浏览器原生选区**：命中处 setSelection + 滚动到视口内。好处是零 DOM 改写，
// 不会与查看器自己的渲染（Markdown 的标记、代码高亮的 span、表格结构）打架。
// 代价是同时只能突出一个命中 —— 用"3 / 17"的计数补上"一共有多少处"。

import { Button } from "@components/ui";
import { ChevronLeft, ChevronRight, Search, X } from "@components/ui/icons";
import { isTypingTarget } from "@shared/utils";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
	Show,
} from "solid-js";
import {
	findInTextNodes,
	MAX_MATCHES,
	type TextMatch,
} from "../lib/findInText.ts";
import styles from "./viewers.module.css";

/** 容器里的全部文本节点（按文档顺序） */
function collectTextNodes(root: HTMLElement): Text[] {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	let node = walker.nextNode();
	while (node) {
		nodes.push(node as Text);
		node = walker.nextNode();
	}
	return nodes;
}

export const FindOverlay: Component<{
	/** 查找范围所在的容器（通常就是查看器外壳那层） */
	container: () => HTMLElement | undefined;
	/** 换文件时清空并收起（内容变了，旧的命中没有意义） */
	resetKey?: () => string;
}> = (props) => {
	const [open, setOpen] = createSignal(false);
	const [query, setQuery] = createSignal("");
	const [index, setIndex] = createSignal(0);
	// 打开时与换文件时重新扫描：文本节点的集合不是响应式的（DOM 由查看器自己渲染）
	const [scanToken, setScanToken] = createSignal(0);
	let inputRef: HTMLInputElement | undefined;

	const scan = createMemo<{
		nodes: Text[];
		matches: TextMatch[];
		capped: boolean;
	}>(() => {
		scanToken();
		const root = props.container();
		const nodes = root ? collectTextNodes(root) : [];
		const found = findInTextNodes(
			nodes.map((n) => n.data),
			query(),
		);
		return { nodes, matches: found.matches, capped: found.capped };
	});

	const total = () => scan().matches.length;
	const active = () => scan().matches[index()];

	// 命中处 setSelection + 滚进视口
	createEffect(() => {
		const match = active();
		const root = props.container();
		if (!match || !root) return;
		const node = scan().nodes[match.nodeIndex];
		if (!node) return;
		const range = document.createRange();
		range.setStart(node, match.start);
		range.setEnd(node, match.end);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
		// 用 rect 差手动滚动，而不是 scrollIntoView：后者会连带把整个页面也滚一遍
		const rect = range.getBoundingClientRect();
		const box = root.getBoundingClientRect();
		if (rect.top < box.top || rect.bottom > box.bottom) {
			root.scrollTop += rect.top - box.top - box.height / 3;
		}
	});

	const step = (delta: number) => {
		const count = total();
		if (count === 0) return;
		// 环形循环：到末尾再按"下一个"回到第一处
		setIndex((i) => (i + delta + count) % count);
	};

	const close = () => {
		setOpen(false);
		window.getSelection()?.removeAllRanges();
	};

	// 换文件：收起并清空
	createEffect(() => {
		props.resetKey?.();
		close();
		setQuery("");
		setIndex(0);
	});

	const onKeyDown = (e: KeyboardEvent) => {
		// 自己那个查找输入框不算"在别处输入"：Ctrl+F 在它里面也要能重新聚焦
		const editing = e.target !== inputRef && isTypingTarget(e.target);
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && !editing) {
			e.preventDefault();
			setOpen(true);
			setScanToken((n) => n + 1);
			inputRef?.focus();
			inputRef?.select();
			return;
		}
		if (!open()) return;
		if (e.key === "Escape") {
			e.preventDefault();
			close();
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			step(e.shiftKey ? -1 : 1);
		}
	};
	document.addEventListener("keydown", onKeyDown);
	onCleanup(() => document.removeEventListener("keydown", onKeyDown));

	const onInput = (value: string) => {
		setQuery(value);
		setIndex(0);
	};

	return (
		<Show
			when={open()}
			fallback={
				<Button
					variant="icon"
					class={styles.findTrigger}
					title="查找（Ctrl/⌘+F）"
					ariaLabel="在预览中查找"
					onClick={() => {
						setOpen(true);
						setScanToken((n) => n + 1);
						inputRef?.focus();
					}}
				>
					<Search size={14} />
				</Button>
			}
		>
			{/* 不用 role="search"：那要求用 <search> 元素（baseline 2025 才齐），
			    项目基线是 chrome111 / safari16.4。可访问名落在 input 上，计数走 aria-live */}
			<div class={styles.findBar}>
				<input
					ref={inputRef}
					class={styles.findInput}
					type="search"
					placeholder="在预览中查找"
					aria-label="查找内容"
					value={query()}
					onInput={(e) => onInput(e.currentTarget.value)}
				/>
				<span class={styles.findCount} aria-live="polite">
					<Show
						when={query().trim()}
						fallback={<span class={styles.findHint}>输入关键字</span>}
					>
						{total() === 0
							? "无结果"
							: `${index() + 1} / ${total()}${scan().capped ? `+（上限 ${MAX_MATCHES}）` : ""}`}
					</Show>
				</span>
				<Button
					variant="icon"
					title="上一处（Shift+Enter）"
					disabled={total() === 0}
					onClick={() => step(-1)}
				>
					<ChevronLeft size={14} />
				</Button>
				<Button
					variant="icon"
					title="下一处（Enter）"
					disabled={total() === 0}
					onClick={() => step(1)}
				>
					<ChevronRight size={14} />
				</Button>
				<Button variant="icon" title="关闭（Esc）" onClick={close}>
					<X size={14} />
				</Button>
			</div>
		</Show>
	);
};
