// ── 首页：左侧待办，右侧最近卡片，中间命令面板入口 ──

import { useAuth } from "@app/context/auth.tsx";
import {
	AsyncView,
	LoadingSkeleton,
	PageFrame,
	Panel,
	SegmentedControl,
	SplitWorkspace,
} from "@components/ui";
import { ArrowRight, Search } from "@components/ui/icons";
import { MODULE_CARDS } from "@config/module-cards.ts";
import { fillPath, PATHS } from "@config/paths";
import type { CardData } from "@modules/card";
import {
	CardMasonry,
	deleteCardE as apiDeleteCard,
	getCardsE,
} from "@modules/card";
import { OPEN_COMMAND_PALETTE_EVENT } from "@modules/command-palette";
import {
	HOME_TASK_SCOPES,
	TaskProvider,
	TaskRows,
	TASK_SORT_OPTIONS,
	countScopes,
	scopeTasks,
	useTasks,
} from "@modules/task";
import type { TaskScope, TaskSortKey } from "@modules/task";
import {
	getGreeting,
	notifyError,
	notifySuccess,
	parseUtc,
	showConfirm,
	useListResource,
} from "@shared/utils";
import { A, useNavigate } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import styles from "./HomePage.module.css";

const dateLabel = new Intl.DateTimeFormat("zh-CN", {
	month: "long",
	day: "numeric",
	weekday: "long",
});

function ModuleNav() {
	return (
		<nav class={styles.moduleNav} aria-label="模块导航">
			<For each={MODULE_CARDS}>
				{(module) => (
					<A href={module.path} class={styles.moduleCard}>
						<span
							class={styles.moduleIconWrap}
							style={`--module-accent: ${module.color}`}
						>
							<svg
								class={styles.moduleIcon}
								viewBox="0 0 24 24"
								fill="none"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d={module.icon} />
							</svg>
						</span>
						<span class={styles.moduleLabel}>{module.label}</span>
					</A>
				)}
			</For>
		</nav>
	);
}

function CommandTrigger() {
	return (
		<button
			type="button"
			class={styles.commandTrigger}
			onClick={() =>
				globalThis.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))
			}
			aria-label="打开命令面板"
			aria-keyshortcuts="Control+K"
		>
			<Search class={styles.searchIcon} size={17} aria-hidden="true" />
			<span class={styles.commandLabel}>搜索、跳转或执行命令…</span>
			<kbd class={styles.commandKbd}>Ctrl K</kbd>
		</button>
	);
}

function TodoPanel() {
	const { tasks, loading, sort, setSort, updateStatus, removeTask } =
		useTasks();
	const [scope, setScope] = createSignal<TaskScope>("all");
	const visible = createMemo(() => scopeTasks(tasks(), scope()));
	const counts = createMemo(() => countScopes(tasks()));

	return (
		<Panel
			class={styles.panel}
			fill
			title="待办"
			hint={`${visible().length} 件 · 默认智能排序`}
			actions={
				<A href={PATHS.task} class={styles.viewAll}>
					任务页 <ArrowRight size={14} />
				</A>
			}
			toolbar={
				<div class={styles.controls}>
					<SegmentedControl
						class={styles.scopeControl}
						options={HOME_TASK_SCOPES.map((item) => ({
							value: item.key,
							label: item.label,
							count: counts()[item.key],
						}))}
						value={scope()}
						onChange={setScope}
						ariaLabel="时间范围"
					/>
					<select
						class={styles.sort}
						value={sort()}
						onChange={(event) =>
							setSort(event.currentTarget.value as TaskSortKey)
						}
						aria-label="排序方式"
					>
						<For each={TASK_SORT_OPTIONS}>
							{(item) => <option value={item.value}>{item.label}</option>}
						</For>
					</select>
				</div>
			}
			scroll
		>
			<Show when={!loading()} fallback={<LoadingSkeleton rows={4} />}>
				<Show
					when={visible().length > 0}
					fallback={
						<div class={styles.empty}>
							<p>没有符合条件的待办</p>
							<p>换个时间范围，或者去任务页新建一条。</p>
						</div>
					}
				>
					<TaskRows
						tasks={visible()}
						allTasks={tasks()}
						onStatusChange={(id, status) => void updateStatus(id, status)}
						onDelete={(id) => void removeTask(id)}
					/>
				</Show>
			</Show>
		</Panel>
	);
}

function CardPanel() {
	const navigate = useNavigate();
	const list = useListResource<null, CardData>({
		key: () => null,
		fetcher: async () => {
			const r = (await getCardsE()) as { items: CardData[] };
			return [...r.items].sort(
				(a, b) =>
					parseUtc(b.updated_at).getTime() - parseUtc(a.updated_at).getTime(),
			);
		},
	});
	const recentCards = () => list.items().slice(0, 8);

	const handleDelete = async (id: number) => {
		const confirmed = await showConfirm({
			title: "删除卡片",
			message: "确定要删除这个卡片吗？此操作不可撤销。",
			variant: "danger",
			confirmLabel: "删除",
		});
		if (!confirmed) return;
		const result = await list.optimistic(
			(cards) => cards.filter((card) => card.id !== id),
			() => apiDeleteCard(id),
		);
		if (result.ok) notifySuccess("卡片已删除");
		else notifyError("删除卡片失败", result.error);
	};

	return (
		<Panel
			class={styles.panel}
			fill
			title="最近卡片"
			hint="最近更新的知识卡片"
			actions={
				<>
					<A href={PATHS.card} class={styles.viewAll}>
						全部 <ArrowRight size={14} />
					</A>
					<A href={PATHS.cardAdd} class={styles.newCard}>
						新建
					</A>
				</>
			}
			scroll
		>
			<AsyncView
				data={recentCards()}
				loading={list.loading()}
				emptyMessage="暂无知识卡片"
			>
				{(data) => (
					<CardMasonry
						cards={[...data()]}
						onCardClick={(id) => navigate(fillPath(PATHS.cardDetail, id))}
						onCardEdit={(id) => navigate(fillPath(PATHS.cardEdit, id))}
						onCardDelete={handleDelete}
						emptyMessage="暂无知识卡片"
					/>
				)}
			</AsyncView>
		</Panel>
	);
}

function HomeContent() {
	const { auth } = useAuth();
	const userName = () => auth().user?.name ?? "";

	return (
		<PageFrame
			header={
				<header class={styles.homeHeader}>
					<div class={styles.greeting}>
						<p class={styles.eyebrow}>{dateLabel.format(new Date())}</p>
						<h1 class={styles.welcomeTitle}>
							{getGreeting()}，{userName()}
						</h1>
					</div>
					<ModuleNav />
				</header>
			}
			toolbar={
				<div class={styles.searchBand}>
					<CommandTrigger />
				</div>
			}
		>
			<SplitWorkspace main={<TodoPanel />} side={<CardPanel />} />
		</PageFrame>
	);
}

export default function HomePage() {
	return (
		<TaskProvider>
			<HomeContent />
		</TaskProvider>
	);
}
