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
import {
	getGreeting,
	notifyError,
	notifySuccess,
	parseUtc,
	showConfirm,
	useListResource,
} from "@shared/utils";
import { A, useNavigate } from "@solidjs/router";
import { Show } from "solid-js";
import styles from "./HomePage.module.css";

function ModuleNav() {
	return (
		<nav class={styles.moduleNav}>
			{MODULE_CARDS.map((m) => (
				<A href={m.path} class={styles.moduleCard}>
					{/* 识别色作为自定义属性交给 CSS 消费：底色的透明度与图标描边
					    都写在 HomePage.module.css 里，TS 不拼样式值 */}
					<div
						class={styles.moduleIconWrap}
						style={{ "--module-accent": m.color }}
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
	// 端点是 {items} 形状（不分页），取全量后在 fetcher 里按更新时间排序
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

	const recentCards = () => list.items().slice(0, 4);

	const handleDelete = async (id: number) => {
		const confirmed = await showConfirm({
			title: "删除卡片",
			message: "确定要删除这个卡片吗？此操作不可撤销。",
			variant: "danger",
			confirmLabel: "删除",
		});
		if (!confirmed) return;
		// 先本地移除、失败由原语回滚到操作前快照。
		// 注意顺序：原实现把移除放在确认框**之前**，用户点"取消"卡片也会消失
		const res = await list.optimistic(
			(cards) => cards.filter((c) => c.id !== id),
			() => apiDeleteCard(id),
		);
		if (res.ok) notifySuccess("卡片已删除");
		else notifyError("删除卡片失败", res.error);
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
