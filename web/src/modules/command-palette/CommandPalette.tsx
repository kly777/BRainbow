// ── 命令面板（⌘K）：导航 / 站内搜索 / 指令 / 移动端 FAB ──

import { EmptyState, Input, Spinner, Tooltip } from "@components/ui";
import { X } from "@components/ui/icons";
import { createMemo, For, type JSX, Show } from "solid-js";
import styles from "./CommandPalette.module.css";
import {
	MODE_PLACEHOLDER,
	MODE_PREFIX,
	type Mode,
	optionDomId,
	type Suggestion,
	usePalette,
} from "./view/usePalette.ts";

/** 列表容器 id：输入框的 `aria-controls` 指向它（combobox 与 listbox 的规范关联） */
const LISTBOX_ID = "palette-listbox";

function SuggestionItem(props: {
	item: Suggestion;
	/** 在列表里的下标（可选项才有 id，供输入框的 aria-activedescendant 指向） */
	index: number;
	active: boolean;
	onHover: () => void;
}) {
	if (props.item.isHeader) {
		return (
			<div class={styles.group} role="presentation" data-kind={props.item.kind}>
				<span class={styles.groupDot} />
				<span class={styles.groupLabel}>{props.item.label}</span>
			</div>
		);
	}
	// 命令与路径是字面语法（`:home`、`/file`），用等宽；页面名与搜索结果标题用正文字体
	const mono = props.item.glyph === ":" || props.item.glyph === "/";
	return (
		<button
			type="button"
			id={optionDomId(props.index)}
			class={styles.row}
			classList={{ [styles.rowActive]: props.active }}
			onMouseDown={(e) => e.preventDefault()}
			onMouseEnter={props.onHover}
			onClick={props.item.onSelect}
			role="option"
			aria-selected={props.active}
			data-kind={props.item.kind}
		>
			<span class={styles.rowGlyph} aria-hidden="true">
				{props.item.glyph ?? "•"}
			</span>
			<span class={styles.rowLabel} classList={{ [styles.rowLabelMono]: mono }}>
				{props.item.label}
			</span>
			{props.item.highlightedDesc ? (
				<span
					class={styles.rowDesc}
					// 这里用 innerHTML 是刻意的：命中的关键词要加 <mark>；内容在
					// 组装建议时已经先转义再插标记（见 shared/utils/highlight.ts）
					innerHTML={props.item.highlightedDesc}
				/>
			) : (
				<span class={styles.rowDesc}>{props.item.desc}</span>
			)}
			{props.item.extra && (
				<span class={styles.rowHint}>{props.item.extra}</span>
			)}
		</button>
	);
}

function SuggestionList(props: {
	items: Suggestion[];
	selected: number;
	onHover: (i: number) => void;
	listRef: (el: HTMLDivElement) => void;
}) {
	return (
		<div class={styles.list} id={LISTBOX_ID} role="listbox">
			<div ref={props.listRef} class={styles.scroll}>
				<For each={props.items}>
					{(s, i) => (
						<SuggestionItem
							item={s}
							index={i()}
							active={i() === props.selected}
							onHover={() => props.onHover(i())}
						/>
					)}
				</For>
			</div>
		</div>
	);
}

/** 面板里"不是列表"的那几种：未匹配 / 搜索中 / 只差一次回车。同一个版式，居中一行 */
function PanelState(props: { children: JSX.Element }) {
	return <div class={styles.state}>{props.children}</div>;
}

/** 模式名（显示在输入框右侧）；idle 不显示 */
const MODE_NAME: Record<Mode, string> = {
	idle: "",
	nav: "导航",
	search: "搜索",
	cmd: "指令",
};

/** idle 的字形：应用自己的词汇（FAB 与落页提示都用 ⌘），有前缀时就显示那个前缀 */
const IDLE_GLYPH = "⌘";

export default function CommandPalette() {
	const p = usePalette();

	/** 播报文本：只数可选项（分组标题不算），空则说"无匹配项" */
	const resultAnnouncement = createMemo(() => {
		const count = p.currentItems().filter((item) => !item.isHeader).length;
		if (p.searching()) return "搜索中";
		return count > 0 ? `${count} 项可选` : "无匹配项";
	});

	const ActionPanel = () => {
		const m = p.mode();
		const q = p.query();
		// idle：空输入列可跳页面（最近访问优先），打字 = 本地匹配 + "在站内搜索"一行
		if (m === "idle") {
			if (p.currentItems().length > 0)
				return (
					<SuggestionList
						items={p.currentItems()}
						selected={p.selectedIndex()}
						onHover={p.setSelectedIndex}
						listRef={p.bindSugScroll}
					/>
				);
			return null;
		}
		if (m === "nav") {
			if (p.navItems().length > 0)
				return (
					<SuggestionList
						items={p.navItems()}
						selected={p.selectedIndex()}
						onHover={p.setSelectedIndex}
						listRef={p.bindSugScroll}
					/>
				);
			if (q)
				return (
					<PanelState>
						<EmptyState title="未匹配" compact />
					</PanelState>
				);
		}
		if (m === "cmd") {
			if (p.cmdItems().length > 0)
				return (
					<SuggestionList
						items={p.cmdItems()}
						selected={p.selectedIndex()}
						onHover={p.setSelectedIndex}
						listRef={p.bindSugScroll}
					/>
				);
			if (q)
				return (
					<PanelState>
						<EmptyState title={p.auth().user ? "已登录" : "未登录"} compact />
					</PanelState>
				);
		}
		if (m === "search") {
			if (p.searchItems().length > 0)
				return (
					<SuggestionList
						items={p.searchItems()}
						selected={p.selectedIndex()}
						onHover={p.setSelectedIndex}
						listRef={p.bindSugScroll}
					/>
				);
			if (p.searching() && q)
				return (
					<PanelState>
						<Spinner />
						搜索中…
					</PanelState>
				);
			if (q)
				return (
					<PanelState>
						<kbd>Enter</kbd> 搜索「{q}」
					</PanelState>
				);
		}
		return null;
	};

	return (
		<>
			{/* 遮罩 + 面板 */}
			<Show when={p.open()}>
				<button
					type="button"
					class={styles.overlay}
					onClick={p.close}
					aria-label="关闭命令面板"
				/>
				<div
					class={styles.bar}
					role="dialog"
					aria-modal="true"
					aria-label="命令面板"
				>
					<div class={styles.header}>
						<span class={styles.modeGlyph} aria-hidden="true">
							{MODE_PREFIX[p.mode() as Mode] || IDLE_GLYPH}
						</span>
						<Input
							ref={p.bindInput}
							class={styles.field}
							placeholder={MODE_PLACEHOLDER[p.mode() as Mode]}
							value={p.value()}
							onInput={(e) => {
								p.setValue(e.currentTarget.value);
								p.setSelectedIndex(0);
							}}
							onCompositionStart={p.onCompositionStart}
							onCompositionEnd={p.onCompositionEnd}
							onKeyDown={p.onInputKey}
							role="combobox"
							aria-expanded={true}
							aria-haspopup="listbox"
							aria-autocomplete="list"
							aria-controls={LISTBOX_ID}
							// 焦点始终留在输入框（输入法/打字才正常），读屏靠这个知道高亮的是哪条
							aria-activedescendant={p.activeOptionId()}
							aria-label="搜索或执行命令"
						/>
						{/* 模式名（idle 不显示）：输入框右侧，替代原先左侧的重复色块 */}
						<span class={styles.modeName}>{MODE_NAME[p.mode() as Mode]}</span>
						{/* 窄屏才显示（CSS 控制）：移动端没有 Esc，浮层得有个看得见的出口。
						    可访问名用"关闭"而不是"关闭命令面板"——遮罩按钮已经占了后者 */}
						<button
							type="button"
							class={styles.closeBtn}
							onClick={p.close}
							aria-label="关闭"
						>
							<X size={16} />
						</button>
					</div>
					<div class={styles.body}>{ActionPanel()}</div>
					{/* 页脚 = 状态条：左"多少项"（兼读屏播报），右快捷键提示（窄屏隐藏） */}
					<div class={styles.footer}>
						<span class={styles.status} aria-live="polite">
							{resultAnnouncement()}
						</span>
						<span class={styles.hints}>
							<kbd>↑</kbd>
							<kbd>↓</kbd> 选择
							<kbd>↵</kbd> 打开
							<kbd>esc</kbd> 关闭
						</span>
					</div>
				</div>
			</Show>

			{/* 移动端 FAB（桌面隐藏） */}
			<Tooltip label="命令面板">
				<button
					type="button"
					class={styles.fab}
					onClick={() => p.openPalette()}
					aria-label="打开命令面板"
				>
					⌘
				</button>
			</Tooltip>
		</>
	);
}
