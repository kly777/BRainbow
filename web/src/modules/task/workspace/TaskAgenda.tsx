// ── 右栏：今天的账 + 未来 7 天 + 手上正在做的 ──

import { A } from "@solidjs/router";
import { fillPath, PATHS } from "@config/paths";
import { createMemo, For, Show } from "solid-js";
import { useTasks } from "../components/TaskProvider.tsx";
import UpcomingPanel from "../components/UpcomingPanel.tsx";
import { bucketOfDue, formatDue } from "../lib/task-group.ts";
import styles from "./TaskAgenda.module.css";

const dateLabel = new Intl.DateTimeFormat("zh-CN", {
	month: "long",
	day: "numeric",
	weekday: "long",
});

export default function TaskAgenda() {
	const { tasks, stats } = useTasks();

	const today = createMemo(() =>
		tasks().filter(
			(task) =>
				task.status !== "completed" &&
				task.status !== "archived" &&
				bucketOfDue(task.due_at) === "today",
		),
	);
	const active = createMemo(() =>
		tasks()
			.filter((task) => task.status === "active")
			.slice(0, 4),
	);
	const overdue = createMemo(
		() =>
			tasks().filter((task) => {
				const due = formatDue(task.due_at);
				return due?.overdue && task.status !== "completed" ? task : null;
			}).length,
	);

	return (
		<div class={styles.agenda}>
			<section class={styles.todayCard}>
				<p class={styles.eyebrow}>今天</p>
				<p class={styles.date}>{dateLabel.format(new Date())}</p>
				<div class={styles.counts}>
					<div class={styles.countItem}>
						<strong>{today().length}</strong>
						<span>今天到期</span>
					</div>
					<div class={styles.countItem}>
						<strong class={overdue() > 0 ? styles.overdue : undefined}>
							{overdue()}
						</strong>
						<span>逾期</span>
					</div>
					<div class={styles.countItem}>
						<strong>{stats().active}</strong>
						<span>进行中</span>
					</div>
				</div>
			</section>

			<UpcomingPanel />

			<section class={styles.card}>
				<header class={styles.cardHead}>
					<h3 class={styles.cardTitle}>手上正在做</h3>
					<span class={styles.cardCount}>{active().length}</span>
				</header>
				<Show
					when={active().length > 0}
					fallback={<p class={styles.empty}>还没有进行中的任务。</p>}
				>
					<ul class={styles.list}>
						<For each={active()}>
							{(task) => (
								<li>
									<A
										class={styles.activeLink}
										href={fillPath(PATHS.taskDetail, task.id)}
									>
										<span class={styles.activeDot} />
										<span class={styles.activeTitle}>{task.title}</span>
									</A>
								</li>
							)}
						</For>
					</ul>
				</Show>
			</section>
		</div>
	);
}
