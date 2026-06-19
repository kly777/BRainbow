import { A, useNavigate } from "@solidjs/router";
import { createResource, Show } from "solid-js";
import { deleteCardE as apiDeleteCard, getCardsE } from "../apis/cardApi.ts";
import { getErrorMessage } from "../apis/types/index.ts";
import CardsGrid from "../components/card/CardsGrid.tsx";
import type { CardData } from "../components/card/Card.tsx";
import { TaskProvider, useTasks } from "../components/task/TaskProvider.tsx";
import TaskList from "../components/task/TaskList.tsx";
import { AsyncView } from "../components/ui/AsyncView.tsx";
import styles from "./HomePage.module.css";

// 模块入口（纯文字链接）
const MODULES = [
	{ path: "/t", label: "任务" },
	{ path: "/c", label: "卡片" },
	{ path: "/o", label: "本体" },
	{ path: "/m", label: "记忆" },
	{ path: "/text", label: "文本" },
	{ path: "/i", label: "图片" },
];

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
					<A href="/t" class={styles.viewAllLink}>
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
								前往 <A href="/t">任务管理</A> 创建第一个任务
							</p>
						</Show>
						<Show when={loading()}>
							<p>加载中...</p>
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
					new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
			);
		},
	);

	const recentCards = () => (cards() ?? []).slice(0, 4);

	const handleDelete = async (id: number) => {
		if (!confirm("确定要删除这个卡片吗？")) return;
		mutate((prev) => prev?.filter((c) => c.id !== id));
		try {
			await apiDeleteCard(id);
		} catch (e) {
			console.error("删除失败:", getErrorMessage(e));
			refetch();
		}
	};

	return (
		<section class={styles.dashboardSection}>
			<div class={styles.sectionHeader}>
				<h2 class={styles.sectionTitle}>最近卡片</h2>
				<div class={styles.sectionActions}>
					<A href="/c" class={styles.viewAllLink}>
						查看全部 →
					</A>
					<A href="/c" class={styles.createLink}>
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
						onCardClick={(id) => navigate(`/c/${id}`)}
						onCardEdit={(id) => navigate(`/c/edit/${id}`)}
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
