import { useAuth } from "@app/context/auth.tsx";
import { AsyncView } from "@components/ui";
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

// ── 模块入口数据（SVG icon + 配色，路径来自 PATHS 单一来源） ──
const moduleEntries = [
	{
		path: PATHS.task,
		label: "任务",
		desc: "待办事项",
		icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
		color: "var(--m-task)",
	},
	{
		path: PATHS.card,
		label: "卡片",
		desc: "知识库",
		icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
		color: "var(--m-card)",
	},
	{
		path: PATHS.memory,
		label: "记忆",
		desc: "FSRS 复习",
		icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
		color: "var(--m-mem)",
	},
	{
		path: PATHS.ontology,
		label: "本体",
		desc: "概念网络",
		icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
		color: "var(--m-onto)",
	},
	{
		path: PATHS.conversation,
		label: "搜索",
		desc: "知识搜索",
		icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
		color: "var(--m-search)",
	},
	{
		path: PATHS.chat,
		label: "AI",
		desc: "对话",
		icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
		color: "var(--m-chat)",
	},
	{
		path: PATHS.bookmark,
		label: "书签",
		desc: "收藏",
		icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z",
		color: "var(--m-bookmark)",
	},
	{
		path: PATHS.text,
		label: "文本",
		desc: "编辑器",
		icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
		color: "var(--m-text)",
	},
	{
		path: PATHS.image,
		label: "图片",
		desc: "资源",
		icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
		color: "var(--m-image)",
	},
];

/** 获取问候语 */
function getGreeting(): string {
	const h = new Date().getHours();
	if (h < 6) return "夜深了，注意休息";
	if (h < 12) return "早上好";
	if (h < 18) return "下午好";
	return "晚上好";
}

function ModuleNav() {
	return (
		<nav class={styles.moduleNav}>
			{moduleEntries.map((m) => (
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
