import {
	type Component,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import DbTable from "./components/DbTable";
import PaginationBar from "./components/PaginationBar";
import TableHeaderActions from "./components/TableHeaderActions";
import styles from "./DbViewer.module.css";
import { useDbViewer } from "./hooks/useDbViewer.ts";

const DB: Component = () => {
	const m = useDbViewer();
	const [tableSearch, setTableSearch] = createSignal("");
	const [focusIndex, setFocusIndex] = createSignal(-1);
	let listRef: HTMLDivElement | undefined;

	const filteredTables = createMemo(() => {
		const q = tableSearch().toLowerCase().trim();
		const list = m.tables();
		if (!q) return list;
		return list.filter((t) => t.toLowerCase().includes(q));
	});

	// Keyboard navigation for table list
	const handleListKeyDown = (e: KeyboardEvent) => {
		const list = filteredTables();
		if (list.length === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setFocusIndex((i) => Math.min(i + 1, list.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setFocusIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const idx = focusIndex();
			if (idx >= 0 && idx < list.length) {
				m.openTable(list[idx]);
			}
		}
	};

	// Focus the active item when focusIndex changes
	const handleItemRef = (el: HTMLButtonElement, idx: number) => {
		if (idx === focusIndex()) {
			el.focus();
		}
	};

	onMount(() => {
		// Focus search on / key
		const handler = (e: KeyboardEvent) => {
			if (
				e.key === "/" &&
				!(e.target instanceof HTMLInputElement) &&
				!(e.target instanceof HTMLTextAreaElement)
			) {
				e.preventDefault();
				listRef?.querySelector<HTMLInputElement>("input")?.focus();
			}
		};
		document.addEventListener("keydown", handler);
		onCleanup(() => document.removeEventListener("keydown", handler));
	});

	return (
		<div class={styles.page}>
			<nav class={styles.sidebar} aria-label="数据库表列表">
				<div class={styles.sidebarHeader}>
					<div class={styles.sidebarTitleRow}>
						<span class={styles.sidebarTitle}>表列表</span>
						<Show when={m.tables().length > 0}>
							<span class={styles.tableCount}>{m.tables().length}</span>
						</Show>
					</div>
					<input
						type="search"
						class={styles.sidebarSearch}
						placeholder="搜索表… /"
						aria-label="搜索表名"
						value={tableSearch()}
						onInput={(e) => {
							setTableSearch(e.currentTarget.value);
							setFocusIndex(-1);
						}}
						onKeyDown={handleListKeyDown}
					/>
				</div>
				<div
					ref={listRef}
					class={styles.tableList}
					role="listbox"
					aria-label="数据库表"
					onKeyDown={handleListKeyDown}
				>
					<Show
						when={m.tables().length > 0}
						fallback={
							<Show when={!m.loading()}>
								<div class={styles.sidebarEmpty}>
									{m.error() ? "加载失败" : "暂无表"}
								</div>
							</Show>
						}
					>
						<Show when={filteredTables().length === 0 && tableSearch()}>
							<div class={styles.sidebarEmpty}>未匹配</div>
						</Show>
						<For each={filteredTables()}>
							{(t, i) => (
								<button
									type="button"
									role="option"
									aria-selected={m.activeTable() === t}
									onClick={() => m.openTable(t)}
									onFocus={() => setFocusIndex(i())}
									onBlur={() => setFocusIndex(-1)}
									ref={(el) => handleItemRef(el, i())}
									classList={{
										[styles.tableItem]: true,
										[styles.tableItemActive]: m.activeTable() === t,
									}}
								>
									<span class={styles.tableName}>{t}</span>
									<Show when={m.activeTable() === t}>
										<span class={styles.activeIndicator} />
									</Show>
								</button>
							)}
						</For>
					</Show>
				</div>
			</nav>

			<div class={styles.main}>
				{m.error() && <div class={styles.errorBox}>{m.error()}</div>}
				{m.loading() && m.columns().length === 0 && (
					<div class={styles.loading}>加载中…</div>
				)}

				<Show
					when={m.activeTable() && m.columns().length > 0}
					fallback={
						<Show when={!m.loading() && !m.activeTable()}>
							<div class={styles.welcome}>
								<div class={styles.welcomeIcon} />
								<h3 class={styles.welcomeTitle}>数据库浏览器</h3>
								<p class={styles.welcomeDesc}>从左侧选择一张表开始浏览</p>
								<div class={styles.welcomeHint}>
									<kbd>/</kbd> 搜索表
								</div>
							</div>
						</Show>
					}
				>
					<div class={styles.tableHeader}>
						<h3 class={styles.tableTitle} title={m.activeTable()}>
							{m.activeTable()}
						</h3>

						<TableHeaderActions
							filters={m.filters()}
							refFilter={m.refFilter()}
							showFilterChips={m.filterId() > 0 || m.hasFilters()}
							exporting={m.exporting()}
							onRemove={m.removeColumnFilter}
							onClear={m.clearFilters}
							onExport={m.exportTable}
						/>
					</div>

					<DbTable
						tableName={m.activeTable()}
						columns={m.columns()}
						rows={m.rows()}
						filters={m.filters()}
						loading={m.loading()}
						sortCol={m.sortCol()}
						sortDesc={m.sortDesc()}
						previewFor={m.previewFor}
						onSort={m.toggleSort}
						onSetFilter={m.setColumnFilter}
						onJumpToRef={m.jumpToRef}
					/>

					<PaginationBar
						total={m.total()}
						page={m.currentPage()}
						pageSize={m.currentPageSize()}
						totalPages={m.totalPages()}
						filtered={m.filterId() > 0 || m.hasFilters()}
						loading={m.loading()}
						jumpValue={m.jumpValue()}
						onJumpInput={m.setJumpValue}
						onJump={m.reloadTable}
						onPageSizeChange={m.changePageSize}
						onPrev={() => m.reloadTable(m.currentPage() - 1)}
						onNext={() => m.reloadTable(m.currentPage() + 1)}
					/>
				</Show>
			</div>
		</div>
	);
};

export default DB;
