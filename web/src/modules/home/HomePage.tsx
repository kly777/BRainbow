import { useAuth } from "@app/context/auth.tsx";
import { AsyncView, LoadingSkeleton } from "@components/ui";
import { ArrowRight } from "@components/ui/icons";
import { MODULE_CARDS } from "@config/module-cards.ts";
import { fillPath, PATHS } from "@config/paths";
import type { CardData } from "@modules/card";
import {
	deleteCardE as apiDeleteCard,
	CardMasonry,
	getCardsE,
} from "@modules/card";
import { TaskList, TaskProvider, useTasks } from "@modules/task";
import { parseUtc, confirmAndDelete, getGreeting } from "@shared/utils";
import { A, useNavigate } from "@solidjs/router";
import { createResource, Show } from "solid-js";
import styles from "./HomePage.module.css";

function ModuleNav() {
	return (
		<nav class={styles.moduleNav}>
			{MODULE_CARDS.map((m) => (
				<A href={m.path} class={styles.moduleCard}>
					<div
						class={styles.moduleIconWrap}
						style={{ background: `${m.color}14` }}
					>
						<svg
							class={styles.moduleIcon}
							viewBox="0 0 24 24"
							fill="none"
							stroke={m.color}
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d={m.icon} />
						</svg>
					</div>
					<span class={styles.moduleLabel}>{m.label}</span>
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
						查看全部 <ArrowRight size={14} />
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
							<LoadingSkeleton rows={2} />
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
		mutate((prev) => prev?.filter((c) => c.id !== id));
		await confirmAndDelete({
			title: "删除卡片",
			message: "确定要删除这个卡片吗？此操作不可撤销。",
			deleteFn: () => apiDeleteCard(id),
			onError: () => refetch(),
		});
	};

	return (
		<section class={styles.dashboardSection}>
			<div class={styles.sectionHeader}>
				<h2 class={styles.sectionTitle}>最近卡片</h2>
				<div class={styles.sectionActions}>
					<A href={PATHS.card} class={styles.viewAllLink}>
						查看全部 <ArrowRight size={14} />
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
					<CardMasonry
						cards={[...data()]}
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

const HomePage = () => {
	const { auth } = useAuth();
	const userName = () => auth().user?.name ?? "";

	return (
		<div class={styles.homePage}>
			{/* ── 欢迎区 ── */}
			<div class={styles.welcomeBar}>
				<h1 class={styles.welcomeTitle}>
					{getGreeting()}，{userName()}
				</h1>
				<p class={styles.welcomeHint}>选择一个模块开始工作</p>
			</div>

			<ModuleNav />

			<div class={styles.mainContent}>
				<TaskProvider>
					<TaskOverview />
				</TaskProvider>
				<CardOverview />
			</div>
		</div>
	);
};

export default HomePage;
