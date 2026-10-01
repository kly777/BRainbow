// ── 命令面板（⌘K）：导航 / 站内搜索 / 指令 / 移动端 FAB ──

import { EmptyState, Input, Spinner, Tooltip } from "@components/ui";
import { createMemo, For, Show } from "solid-js";
import styles from "./CommandPalette.module.css";
import {
	MODE_PLACEHOLDER,
	MODE_PREFIX,
	type Mode,
	optionDomId,
	type Suggestion,
	usePalette,
} from "./hooks/usePalette.ts";

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
			<div class={styles.sugHeader} role="presentation">
				<span class={styles.sugHeaderLabel}>{props.item.label}</span>
			</div>
		);
	}
	return (
		<button
			type="button"
			id={optionDomId(props.index)}
			class={styles.suggestionItem}
			classList={{ [styles.suggestionActive]: props.active }}
			onMouseDown={(e) => e.preventDefault()}
			onMouseEnter={props.onHover}
			onClick={props.item.onSelect}
			role="option"
			aria-selected={props.active}
		>
			<span class={styles.sugLabel}>{props.item.label}</span>
			{props.item.highlightedDesc ? (
				<span
					class={styles.sugDesc}
					// 这里用 innerHTML 是刻意的：命中的关键词要加 <mark>；内容在
					// 组装建议时已经先转义再插标记（见 shared/utils/highlight.ts）
					innerHTML={props.item.highlightedDesc}
				/>
			) : (
				<span class={styles.sugDesc}>{props.item.desc}</span>
			)}
			{props.item.extra && (
				<span class={styles.sugPath}>{props.item.extra}</span>
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
		<div class={styles.suggestions} id={LISTBOX_ID} role="listbox">
			<div ref={props.listRef} class={styles.sugScroll}>
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
			<div class={styles.sugFooter}>
				<span>
					<kbd>↑</kbd>
					<kbd>↓</kbd> 选择
				</span>
				<span>
					<kbd>Enter</kbd> 打开
				</span>
				<span>
					<kbd>Esc</kbd> 关闭
				</span>
			</div>
		</div>
	);
}

/** 面板内的空态：换成共享 EmptyState，只保留面板自己的滚动容器 */
function EmptyPanel(props: { text: string }) {
	return (
		<div class={styles.suggestions}>
			<div class={styles.sugScroll}>
				<EmptyState title={props.text} compact />
			</div>
		</div>
	);
}

function SearchingState() {
	return (
		<div class={styles.suggestions}>
			<div class={styles.sugScroll}>
				<div class={styles.searching}>
					<Spinner />
					搜索中…
				</div>
			</div>
		</div>
	);
}

function SearchHint(props: { query: string }) {
	return (
		<div class={styles.suggestions}>
			<div class={styles.sugScroll}>
				<div class={styles.searchHint}>
					<kbd>Enter</kbd> 搜索 「{props.query}」
				</div>
			</div>
		</div>
	);
}

function ModeTag(props: { mode: Mode }) {
	const labels: Record<Mode, string> = {
		idle: "",
		nav: "导航",
		search: "搜索",
		cmd: "指令",
	};
	if (!labels[props.mode]) return null;
	return <span class={styles.modeTag}>{labels[props.mode]}</span>;
}

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
			if (q) return <EmptyPanel text="未匹配" />;
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
			if (q) return <EmptyPanel text={p.auth().user ? "已登录" : "未登录"} />;
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
			if (p.searching() && q) return <SearchingState />;
			if (q) return <SearchHint query={q} />;
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
					<div class={styles.inputRow}>
						<span class={styles.prefix}>{MODE_PREFIX[p.mode() as Mode]}</span>
						<ModeTag mode={p.mode()} />
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
						{/* 结果条数播报：读屏用户看不到列表在收窄 */}
						<span class="sr-only" aria-live="polite">
							{resultAnnouncement()}
						</span>
					</div>
					{ActionPanel()}
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
