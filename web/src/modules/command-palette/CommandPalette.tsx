// ── 命令面板（⌘K）：导航 / 站内搜索 / 指令 / 移动端 FAB ──

import { Tooltip } from "@components/ui";
import { For, Show } from "solid-js";
import styles from "./CommandPalette.module.css";
import {
	MODE_PLACEHOLDER,
	MODE_PREFIX,
	type Mode,
	type Suggestion,
	usePalette,
} from "./hooks/usePalette.ts";

function SuggestionList(props: {
	items: Suggestion[];
	selected: number;
	onHover: (i: number) => void;
	listRef: (el: HTMLDivElement) => void;
}) {
	return (
		<div class={styles.suggestions}>
			<div ref={props.listRef} class={styles.sugScroll}>
				<For each={props.items}>
					{(s, i) => (
						<button
							type="button"
							class={styles.suggestionItem}
							classList={{
								[styles.suggestionActive]: i() === props.selected,
							}}
							onMouseDown={(e) => e.preventDefault()}
							onMouseEnter={() => props.onHover(i())}
							onClick={s.onSelect}
						>
							<span class={styles.sugLabel}>{s.label}</span>
							<span class={styles.sugDesc}>{s.desc}</span>
							{s.extra && <span class={styles.sugPath}>{s.extra}</span>}
						</button>
					)}
				</For>
			</div>
			<div class={styles.sugFooter}>
				<span>↑↓ 选择</span>
				<span>Enter 打开</span>
				<span>Esc 关闭</span>
			</div>
		</div>
	);
}

function EmptyState(props: { text: string }) {
	return (
		<div class={styles.suggestions}>
			<div class={styles.sugScroll}>
				<div class={styles.empty}>{props.text}</div>
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
			if (q) return <EmptyState text="未匹配" />;
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
			if (q) return <EmptyState text={p.auth().user ? "已登录" : "未登录"} />;
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
			if (p.searching() && q) return <EmptyState text="搜索中…" />;
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
					aria-label="关闭"
				/>
				<div class={styles.bar}>
					<div class={styles.inputRow}>
						<span class={styles.prefix}>{MODE_PREFIX[p.mode() as Mode]}</span>
						<input
							ref={p.bindInput}
							class={styles.input}
							placeholder={MODE_PLACEHOLDER[p.mode() as Mode]}
							value={p.value()}
							onInput={(e) => {
								p.setValue(e.currentTarget.value);
								// 输入变化后列表重建，选中回到第一项
								p.setSelectedIndex(0);
							}}
							onKeyDown={p.onInputKey}
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
				>
					⌘
				</button>
			</Tooltip>
		</>
	);
}
