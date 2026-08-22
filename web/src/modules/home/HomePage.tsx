import { AsyncView } from "@components/ui";
import { fillPath, PATHS } from "@config/paths";
import { parseUtc, showConfirm, tryOrNotify } from "@lib/utils";
import { useAuth } from "@modules/auth";
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
		label: "\u4EFB\u52A1",
		desc: "\u5F85\u529E\u4E8B\u9879",
		icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
		color: "var(--t-color-accent)",
	},
	{
		path: PATHS.card,
		label: "\u5361\u7247",
		desc: "\u77E5\u8BC6\u5E93",
		icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
		color: "oklch(55% 0.13 160deg)",
	},
	{
		path: PATHS.memory,
		label: "\u8BB0\u5FC6",
		desc: "FSRS \u590D\u4E60",
		icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
		color: "oklch(60% 0.12 85deg)",
	},
	{
		path: PATHS.ontology,
		label: "\u672C\u4F53",
		desc: "\u6982\u5FF5\u7F51\u7EDC",
		icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
		color: "oklch(50% 0.14 255deg)",
	},
	{
		path: PATHS.conversation,
		label: "\u641C\u7D22",
		desc: "\u77E5\u8BC6\u641C\u7D22",
		icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
		color: "oklch(55% 0.16 25deg)",
	},
	{
		path: PATHS.chat,
		label: "AI",
		desc: "\u5BF9\u8BDD",
		icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
		color: "oklch(55% 0.12 300deg)",
	},
	{
		path: PATHS.bookmark,
		label: "\u4E66\u7B7E",
		desc: "\u6536\u85CF",
		icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z",
		color: "oklch(55% 0.1 80deg)",
	},
	{
		path: PATHS.text,
		label: "\u6587\u672C",
		desc: "\u7F16\u8F91\u5668",
		icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
		color: "oklch(45% 0.1 200deg)",
	},
	{
		path: PATHS.image,
		label: "\u56FE\u7247",
		desc: "\u8D44\u6E90",
		icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
		color: "oklch(50% 0.12 330deg)",
	},
];

/** \u83B7\u53D6\u95EE\u5019\u8BED */
function getGreeting(): string {
	const h = new Date().getHours();
	if (h < 6) return "\u591C\u6DF1\u4E86\uFF0C\u6CE8\u610F\u4F11\u606F";
	if (h < 12) return "\u65E9\u4E0A\u597D";
	if (h < 18) return "\u4E0B\u5348\u597D";
	return "\u665A\u4E0A\u597D";
}

function ModuleNav() {
	return (
		<nav class={styles.moduleNav}>
			{moduleEntries.map((m, i) => (
				<A
					href={m.path}
					class={styles.moduleCard}
					style={{ "animation-delay": `${i * 50}ms` }}
				>
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
				<h2 class={styles.sectionTitle}>\u5F85\u529E\u4E8B\u9879</h2>
				<div class={styles.sectionActions}>
					<A href={PATHS.task} class={styles.viewAllLink}>
						\u67E5\u770B\u5168\u90E8 \u2192
					</A>
				</div>
			</div>

			<Show
				when={pending().length > 0}
				fallback={
					<div class={styles.emptyState}>
						<Show when={!loading()}>
							<p>\u6682\u65E0\u4EFB\u52A1</p>
							<p class={styles.emptyHint}>
								\u524D\u5F80 <A href={PATHS.task}>\u4EFB\u52A1\u7BA1\u7406</A>{" "}
								\u521B\u5EFA\u7B2C\u4E00\u4E2A\u4EFB\u52A1
							</p>
						</Show>
						<Show when={loading()}>
							<p>\u52A0\u8F7D\u4E2D\u2026</p>
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
			title: "\u5220\u9664\u5361\u7247",
			message:
				"\u786E\u5B9A\u8981\u5220\u9664\u8FD9\u4E2A\u5361\u7247\u5417\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
			variant: "danger",
		});
		if (!confirmed) return;
		mutate((prev) => prev?.filter((c) => c.id !== id));
		const ok = await tryOrNotify(
			() => apiDeleteCard(id),
			"\u5220\u9664\u5361\u7247",
		);
		if (!ok) refetch();
	};

	return (
		<section class={styles.dashboardSection}>
			<div class={styles.sectionHeader}>
				<h2 class={styles.sectionTitle}>\u6700\u8FD1\u5361\u7247</h2>
				<div class={styles.sectionActions}>
					<A href={PATHS.card} class={styles.viewAllLink}>
						\u67E5\u770B\u5168\u90E8 \u2192
					</A>
					<A href={PATHS.cardAdd} class={styles.createLink}>
						+ \u65B0\u5EFA
					</A>
				</div>
			</div>
			<AsyncView
				data={recentCards()}
				loading={cards.loading}
				emptyMessage="\u6682\u65E0\u77E5\u8BC6\u5361\u7247"
			>
				{(data) => (
					<CardsGrid
						cards={data}
						showFilters={false}
						onCardClick={(id) => navigate(fillPath(PATHS.cardDetail, id))}
						onCardEdit={(id) => navigate(fillPath(PATHS.cardEdit, id))}
						onCardDelete={handleDelete}
						emptyMessage="\u6682\u65E0\u77E5\u8BC6\u5361\u7247"
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
			{/* ── \u6B22\u8FCE\u533A ── */}
			<div class={styles.welcomeBar}>
				<h1 class={styles.welcomeTitle}>
					{getGreeting()}\uFF0C{userName()}
				</h1>
				<p class={styles.welcomeHint}>
					\u9009\u62E9\u4E00\u4E2A\u6A21\u5757\u5F00\u59CB\u5DE5\u4F5C
				</p>
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
