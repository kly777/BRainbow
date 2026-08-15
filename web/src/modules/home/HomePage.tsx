import { AsyncView } from "@components/ui";
import { NAV_ITEMS } from "@config/navigation";
import { fillPath, PATHS } from "@config/paths";
import { parseUtc, showConfirm, tryOrNotify } from "@lib/utils";
import type { CardData } from "@modules/card";
import {
	deleteCardE as apiDeleteCard,
	CardsGrid,
	getCardsE,
} from "@modules/card";
import { TaskList, TaskProvider, useTasks } from "@modules/task";
import { A, useNavigate } from "@solidjs/router";
import { createResource, Show } from "solid-js";
import styles from "./HomePage.module.css";

// 模块入口（纯文字链接）：保序展示，元数据来自 NAV_ITEMS 单一来源
const HOME_MODULE_PATHS = [
	PATHS.task,
	PATHS.card,
	PATHS.ontology,
	PATHS.memory,
	PATHS.conversation,
	PATHS.bookmark,
	PATHS.text,
	PATHS.image,
];
const MODULES = HOME_MODULE_PATHS.map((path) =>
	NAV_ITEMS.find((item) => item.path === path),
).filter((item): item is (typeof NAV_ITEMS)[number] => item !== undefined);

function ModuleNav() {
	return (
		<nav class={styles.moduleNav}>
			{MODULES.map((m) => (
				<A href={m.path} class={styles.moduleCard}>
					{m.label}
				</A>
			))}
		</nav>
	);
}

// ── 任务概览 ──
function TaskOverview() {
	const { tasks, loading, updateStatus, removeTask, updateTaskE, addSubTask } =
		useTasks();

	const pending = () => tasks().filter((t) => t.status !== "completed");

	return (
		<section class={styles.dashboardSection}>
			<div class={styles.sectionHeader}>
				<h2 class={styles.sectionTitle}>待办事项</h2>
				<div class={styles.sectionActions}>
					<A href={PATHS.task} class={styles.viewAllLink}>
						查看全部 →
					</A>
				</div>
			</div>

			<Show
				when={pending().length > 0}
				fallback={
					<div class={styles.emptyState}>
						<Show when={!loading()}>
							<p>暂无任务</p>
							<p class={styles.emptyHint}>
								前往 <A href={PATHS.task}>任务管理</A> 创建第一个任务
							</p>
						</Show>
						<Show when={loading()}>
							<p>加载中…</p>
						</Show>
					</div>
				}
			>
				<TaskList
					tasks={pending()}
					onStatusChange={updateStatus}
					onDelete={removeTask}
					onUpdate={updateTaskE}
					onAddSubTask={addSubTask}
				/>
			</Show>
		</section>
	);
}

// ── 卡片概览 ──
function CardOverview() {
	const navigate = useNavigate();
	const [cards, { mutate, refetch }] = createResource(
		async (): Promise<CardData[]> => {
			const r = (await getCardsE()) as { items: CardData[] };
			return [...r.items].sort(
				(a, b) =>
					parseUtc(b.updated_at).getTime() - parseUtc(a.updated_at).getTime(),
			);
		},
	);

	const recentCards = () => (cards() ?? []).slice(0, 4);

	const handleDelete = async (id: number) => {
		const confirmed = await showConfirm({
			title: "删除卡片",
			message: "确定要删除这个卡片吗？此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;
		mutate((prev) => prev?.filter((c) => c.id !== id));
		const ok = await tryOrNotify(() => apiDeleteCard(id), "删除卡片");
		if (!ok) refetch();
	};

	return (
		<section class={styles.dashboardSection}>
			<div class={styles.sectionHeader}>
				<h2 class={styles.sectionTitle}>最近卡片</h2>
				<div class={styles.sectionActions}>
					<A href={PATHS.card} class={styles.viewAllLink}>
						查看全部 →
					</A>
					<A href={PATHS.cardAdd} class={styles.createLink}>
						+ 新建
					</A>
				</div>
			</div>
			<AsyncView
				data={recentCards()}
				loading={cards.loading}
				emptyMessage="暂无知识卡片"
			>
				{(data) => (
					<CardsGrid
						cards={data}
						showFilters={false}
						onCardClick={(id) => navigate(fillPath(PATHS.cardDetail, id))}
						onCardEdit={(id) => navigate(fillPath(PATHS.cardEdit, id))}
						onCardDelete={handleDelete}
						emptyMessage="暂无知识卡片"
					/>
				)}
			</AsyncView>
		</section>
	);
}

const HomePage = () => (
	<div class={styles.homePage}>
		<ModuleNav />
		<div class={styles.mainContent}>
			<TaskProvider>
				<TaskOverview />
			</TaskProvider>
			<CardOverview />
		</div>
	</div>
);

export default HomePage;
