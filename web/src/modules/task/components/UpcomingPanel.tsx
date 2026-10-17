// ── 未来 7 天：生日 / 纪念日 / 传统节日（应用内提醒，不是推送） ──
//
// 数据来自 `/calendar/upcoming`：服务端只返回已生成的 occurrence，前端不碰农历。

import { Button } from "@components/ui";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import { getUpcomingE, type UpcomingEvent } from "../calendarApi.ts";
import EventForm from "./EventForm.tsx";
import FestivalPicker from "./FestivalPicker.tsx";
import styles from "./UpcomingPanel.module.css";

const dayLabel = (event: UpcomingEvent) => {
	if (event.is_today) return "今天";
	if (event.days_until === 1) return "明天";
	return `${event.days_until} 天后`;
};

const subtitle = (event: UpcomingEvent) => {
	if (event.age !== null) return `${event.age} 岁`;
	if (event.years !== null) return `${event.years} 周年`;
	if (event.kind === "festival") return "节日";
	if (event.kind === "anniversary") return "纪念日";
	return "";
};

const kindLabel = (event: UpcomingEvent) => {
	if (event.kind === "birthday") return "生日";
	if (event.kind === "anniversary") return "纪念日";
	return "节日";
};

const UpcomingPanel: Component = () => {
	const [items, { refetch }] = createResource(() => getUpcomingE(7));
	const [formOpen, setFormOpen] = createSignal(false);
	const [festivalsOpen, setFestivalsOpen] = createSignal(false);

	return (
		<section class={styles.panel} aria-label="未来 7 天">
			<header class={styles.header}>
				<div class={styles.heading}>
					<h3 class={styles.title}>未来 7 天</h3>
					<span class={styles.subtitle}>生日 · 纪念日 · 节日</span>
				</div>
				<div class={styles.actions}>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setFestivalsOpen(true)}
						title="订阅传统节日"
					>
						节日
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setFormOpen(true)}
						aria-label="添加生日或纪念日"
						title="添加生日或纪念日"
					>
						+
					</Button>
				</div>
			</header>

			<Show when={items()} fallback={<p class={styles.empty}>加载中…</p>}>
				{(list) => (
					<Show
						when={list().length > 0}
						fallback={
							<p class={styles.empty}>
								还没有生日、纪念日或节日。点右上角的 + 添加一个。
							</p>
						}
					>
						<ul class={styles.list}>
							<For each={list()}>
								{(event) => (
									<li
										class={styles.item}
										classList={{ [styles.today]: event.is_today }}
										data-kind={event.kind}
										title={`${kindLabel(event)}：${event.title}`}
									>
										<span class={styles.when}>{dayLabel(event)}</span>
										<span class={styles.name}>{event.title}</span>
										<Show when={subtitle(event)}>
											{(text) => <span class={styles.meta}>{text()}</span>}
										</Show>
									</li>
								)}
							</For>
						</ul>
					</Show>
				)}
			</Show>

			<EventForm
				isOpen={formOpen()}
				onClose={() => setFormOpen(false)}
				onSaved={() => void refetch()}
			/>
			<FestivalPicker
				isOpen={festivalsOpen()}
				onClose={() => setFestivalsOpen(false)}
				onSaved={() => void refetch()}
			/>
		</section>
	);
};

export default UpcomingPanel;
