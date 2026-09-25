// ── 命令面板（⌘K）：导航 / 站内搜索 / 指令 / 移动端 FAB ──

import { EmptyState, Input, Spinner, Tooltip } from "@components/ui";
import { For, Show } from "solid-js";
import styles from "./CommandPalette.module.css";
import {
	MODE_PLACEHOLDER,
	MODE_PREFIX,
	type Mode,
	type Suggestion,
	usePalette,
} from "./hooks/usePalette.ts";

function SuggestionItem(props: {
	item: Suggestion;
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
					// suggestions 侧已经做过 HTML 实体转义（见 lib 的 highlight 逻辑）
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
		<div class={styles.suggestions} role="listbox">
			<div ref={props.listRef} class={styles.sugScroll}>
				<For each={props.items}>
					{(s, i) => (
						<SuggestionItem
							item={s}
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
							onKeyDown={p.onInputKey}
							role="combobox"
							aria-expanded={true}
							aria-haspopup="listbox"
							aria-autocomplete="list"
							aria-label="搜索或执行命令"
						/>
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
