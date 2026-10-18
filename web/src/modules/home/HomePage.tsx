// ── 首页：左侧待办，右侧最近卡片，中间命令面板入口 ──

import { useAuth } from "@app/context/auth.tsx";
import { AsyncView, LoadingSkeleton } from "@components/ui";
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
import { TaskProvider, TaskRow, useTasks } from "@modules/task";
import type { Task, TaskSortKey } from "@modules/task";
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

type HomeScope = "all" | "today" | "upcoming" | "overdue";

const SCOPES: readonly { key: HomeScope; label: string }[] = [
	{ key: "all", label: "全部" },
	{ key: "today", label: "今天" },
	{ key: "upcoming", label: "未来 7 天" },
	{ key: "overdue", label: "逾期" },
];

const SORT_OPTIONS: readonly { value: TaskSortKey; label: string }[] = [
	{ value: "smart", label: "智能排序" },
	{ value: "due", label: "按截止" },
	{ value: "priority", label: "按优先级" },
	{ value: "effort", label: "按工时" },
	{ value: "created", label: "按创建" },
];

const dateLabel = new Intl.DateTimeFormat("zh-CN", {
	month: "long",
	day: "numeric",
	weekday: "long",
});

function startOfDay(value: Date): Date {
	const date = new Date(value);
	date.setHours(0, 0, 0, 0);
	return date;
}

/** 本地日历日差；今天 = 0，明天 = 1，逾期 < 0 */
function dayDiff(iso: string | null): number | null {
	if (!iso) return null;
	const due = new Date(iso);
	if (Number.isNaN(due.getTime())) return null;
	return Math.round(
		(startOfDay(due).getTime() - startOfDay(new Date()).getTime()) / 86_400_000,
	);
}

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
	const [scope, setScope] = createSignal<HomeScope>("all");

	const openTasks = createMemo(() =>
		tasks().filter(
			(task) => task.status !== "completed" && task.status !== "archived",
		),
	);
	const taskById = createMemo(
		() => new Map(tasks().map((task) => [task.id, task])),
	);

	const visible = createMemo(() => {
		const list = openTasks();
		switch (scope()) {
			case "today":
				return list.filter((task) => dayDiff(task.due_at) === 0);
			case "upcoming":
				return list.filter((task) => {
					const diff = dayDiff(task.due_at);
					return diff !== null && diff > 0 && diff <= 7;
				});
			case "overdue":
				return list.filter((task) => {
					const diff = dayDiff(task.due_at);
					return diff !== null && diff < 0;
				});
			default:
				return list;
		}
	});

	const count = (next: HomeScope) => {
		const list = openTasks();
		if (next === "all") return list.length;
		return list.filter((task) => {
			const diff = dayDiff(task.due_at);
			if (next === "today") return diff === 0;
			if (next === "overdue") return diff !== null && diff < 0;
			return diff !== null && diff > 0 && diff <= 7;
		}).length;
	};

	const childrenCount = (task: Task) =>
		visible().filter((candidate) => candidate.parent_task_id === task.id)
			.length;

	return (
		<section class={styles.todoPanel} aria-label="待办列表">
			<header class={styles.panelHead}>
				<div>
					<h2 class={styles.panelTitle}>待办</h2>
					<p class={styles.panelHint}>{visible().length} 件 · 默认智能排序</p>
				</div>
				<div class={styles.panelActions}>
					<A href={PATHS.task} class={styles.viewAll}>
						任务页 <ArrowRight size={14} />
					</A>
				</div>
			</header>

			<div class={styles.controls}>
				<div class={styles.scopeTabs} role="group" aria-label="时间范围">
					<For each={SCOPES}>
						{(item) => (
							<button
								type="button"
								class={styles.scopeTab}
								classList={{ [styles.active]: scope() === item.key }}
								aria-pressed={scope() === item.key}
								onClick={() => setScope(item.key)}
							>
								{item.label}
								<span>{count(item.key)}</span>
							</button>
						)}
					</For>
				</div>
				<select
					class={styles.sort}
					value={sort()}
					onChange={(event) =>
						setSort(event.currentTarget.value as TaskSortKey)
					}
					aria-label="排序方式"
				>
					<For each={SORT_OPTIONS}>
						{(item) => <option value={item.value}>{item.label}</option>}
					</For>
				</select>
			</div>

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
					<div class={styles.taskList}>
						<For each={visible()}>
							{(task) => (
								<TaskRow
									task={task}
									childrenCount={childrenCount(task)}
									parentTask={
										task.parent_task_id
											? taskById().get(task.parent_task_id)
											: undefined
									}
									onStatusChange={(id, status) => void updateStatus(id, status)}
									onDelete={(id) => void removeTask(id)}
								/>
							)}
						</For>
					</div>
				</Show>
			</Show>
		</section>
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
		<section class={styles.cardPanel} aria-label="最近卡片">
			<header class={styles.panelHead}>
				<div>
					<h2 class={styles.panelTitle}>最近卡片</h2>
					<p class={styles.panelHint}>最近更新的知识卡片</p>
				</div>
				<div class={styles.panelActions}>
					<A href={PATHS.card} class={styles.viewAll}>
						全部 <ArrowRight size={14} />
					</A>
					<A href={PATHS.cardAdd} class={styles.newCard}>
						新建
					</A>
				</div>
			</header>
			<div class={styles.cardBody}>
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
			</div>
		</section>
	);
}

function HomeContent() {
	const { auth } = useAuth();
	const userName = () => auth().user?.name ?? "";

	return (
		<div class={styles.homePage}>
			<header class={styles.homeHeader}>
				<div class={styles.greeting}>
					<p class={styles.eyebrow}>{dateLabel.format(new Date())}</p>
					<h1 class={styles.welcomeTitle}>
						{getGreeting()}，{userName()}
					</h1>
				</div>
				<ModuleNav />
			</header>

			<div class={styles.searchBand}>
				<CommandTrigger />
			</div>

			<div class={styles.dashboard}>
				<TodoPanel />
				<aside class={styles.rightRail}>
					<CardPanel />
				</aside>
			</div>
		</div>
	);
}

export default function HomePage() {
	return (
		<TaskProvider>
			<HomeContent />
		</TaskProvider>
	);
}
