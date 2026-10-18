// ── /task：页面组合 ──
//
// 数据、URL 状态、范围/排序、日历都在 view/useTaskWorkspace；这里只负责
// 页面骨架与组件摆放。

import {
	EmptyState,
	LoadingSkeleton,
	PageFrame,
	Panel,
	SearchInput,
	SegmentedControl,
	Select,
	SplitWorkspace,
} from "@components/ui";
import {
	CheckCircle2,
	Filter,
	Grid,
	Layers,
	List,
	Plus,
} from "@components/ui/icons";
import { For, Show } from "solid-js";
import type { TaskSortKey } from "./api.ts";
import CaptureInput from "./components/CaptureInput.tsx";
import TaskFilterPanel, {
	ActiveFilterChips,
} from "./components/TaskFilterPanel.tsx";
import TaskCalendar from "./components/TaskCalendar.tsx";
import TaskDag from "./components/TaskDag.tsx";
import TaskRows from "./components/TaskRows.tsx";
import ThreeDayTimeline from "./components/ThreeDayTimeline.tsx";
import { TASK_SORT_OPTIONS } from "./model/task-sort.ts";
import { useTaskWorkspaceView } from "./view/useTaskWorkspace.ts";
import TaskBoard from "./workspace/TaskBoard.tsx";
import TaskCommandBar from "./workspace/TaskCommandBar.tsx";
import styles from "./TaskWorkspace.module.css";

const VIEWS = [
	{ key: "stream", label: "列表", icon: List },
	{ key: "board", label: "看板", icon: Grid },
	{ key: "graph", label: "依赖", icon: Layers },
] as const;

export default function TaskWorkspace() {
	const vm = useTaskWorkspaceView();

	const left = (
		<div class={styles.leftColumn}>
			<section class={styles.composer} aria-label="快速添加任务">
				<div class={styles.composerHead}>
					<span class={styles.composerPlus}>
						<Plus size={16} />
					</span>
					<strong>记一件事</strong>
				</div>
				<CaptureInput
					placeholder="接下来要做什么？"
					parentCandidates={vm.tasks()}
					onSubmit={vm.submit}
				/>
			</section>

			<Panel
				class={styles.listPanel}
				toolbar={
					vm.view() === "stream" ? (
						<div class={styles.toolbarRow}>
							<SegmentedControl
								class={styles.scopeControl}
								options={vm.scopes.map((item) => ({
									value: item.key,
									label: item.label,
									count: vm.counts()[item.key],
								}))}
								value={vm.scope()}
								onChange={vm.chooseScope}
								ariaLabel="时间范围"
							/>
							<Select
								class={styles.sort}
								value={vm.sort()}
								onChange={(e) =>
									vm.setSort(e.currentTarget.value as TaskSortKey)
								}
								aria-label="排序方式"
							>
								<For each={TASK_SORT_OPTIONS}>
									{(item) => <option value={item.value}>{item.label}</option>}
								</For>
							</Select>
						</div>
					) : undefined
				}
				scroll
			>
				<Show when={vm.loading()}>
					<LoadingSkeleton />
				</Show>

				<Show when={!vm.loading()}>
					<Show when={vm.view() === "stream"}>
						<Show
							when={vm.scoped().length > 0}
							fallback={
								<EmptyState
									icon={<CheckCircle2 size={22} />}
									title={
										vm.searchQuery() || vm.hasFilter()
											? "没有符合条件的任务"
											: "这里还没有任务"
									}
									hint={
										vm.searchQuery() || vm.hasFilter()
											? "换个词，或者清掉筛选再看看。"
											: "在下面写一件想做的事。"
									}
									action={
										vm.searchQuery() || vm.hasFilter() ? (
											<button
												type="button"
												class={styles.emptyAction}
												onClick={() => {
													vm.setSearch("");
													vm.setFilter(vm.emptyFilter);
												}}
											>
												清除筛选
											</button>
										) : undefined
									}
								/>
							}
						>
							<TaskRows
								tasks={vm.scoped()}
								allTasks={vm.tasks()}
								onStatusChange={(id, status) =>
									void vm.updateStatus(id, status)
								}
								onDelete={(id) => void vm.removeTask(id)}
							/>
						</Show>
					</Show>

					<Show when={vm.view() === "board"}>
						<TaskBoard />
					</Show>

					<Show when={vm.view() === "graph"}>
						<div class={styles.graphPane}>
							<TaskDag />
						</div>
					</Show>
				</Show>
			</Panel>
		</div>
	);

	const right = (
		<aside class={styles.rightRail}>
			<TaskCalendar calendar={vm.calendar} onOpenTask={vm.openTask} />
			<ThreeDayTimeline />
		</aside>
	);

	return (
		<>
			<PageFrame
				reserveBottom
				header={
					<header class={styles.hero}>
						<div class={styles.heroText}>
							<h1 class={styles.title}>{vm.pageTitle()}</h1>
						</div>
						<div class={styles.heroTools}>
							<div class={styles.viewTabs} role="group" aria-label="任务布局">
								<For each={VIEWS}>
									{(item) => (
										<button
											type="button"
											class={styles.viewTab}
											classList={{ [styles.active]: vm.view() === item.key }}
											aria-pressed={vm.view() === item.key}
											aria-label={item.label}
											title={item.label}
											onClick={() => vm.chooseView(item.key)}
										>
											<item.icon size={15} />
										</button>
									)}
								</For>
							</div>
							<SearchInput
								value={vm.searchQuery()}
								onSearch={vm.setSearch}
								placeholder="搜索任务…"
								class={styles.search}
							/>
							<button
								type="button"
								class={styles.filterButton}
								classList={{ [styles.filterActive]: vm.hasFilter() }}
								aria-expanded={vm.filterOpen()}
								aria-controls="workspace-filter"
								onClick={() => vm.setFilterOpen(!vm.filterOpen())}
							>
								<Filter size={14} />
								筛选
							</button>
						</div>
					</header>
				}
				toolbar={
					vm.filterOpen() ? (
						<div class={styles.filterPanel} id="workspace-filter">
							<TaskFilterPanel
								filter={vm.filter()}
								onChange={vm.setFilter}
								searchTags={vm.searchTags}
							/>
							<div class={styles.filterFoot}>
								<ActiveFilterChips
									filter={vm.filter()}
									onChange={vm.setFilter}
								/>
								<button
									type="button"
									class={styles.clearFilter}
									onClick={() => vm.setFilter(vm.emptyFilter)}
								>
									清空
								</button>
							</div>
						</div>
					) : undefined
				}
			>
				<SplitWorkspace main={left} side={right} />
			</PageFrame>

			<TaskCommandBar onSearch={vm.setSearch} />
		</>
	);
}
