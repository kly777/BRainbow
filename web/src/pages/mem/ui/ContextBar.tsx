// ── v2 上下文条：卡元数据 + 统计 + 编辑 ──

import type { UseMemReview } from "@pages/mem/logic/useMemReview.ts";
import styles from "@pages/mem/ui/ContextBar.module.css";
import Button from "@shared/ui/atoms/Button";
import { Show } from "solid-js";

interface ContextBarProps {
	m: UseMemReview;
	upcomingCounts: { within_8h: number; within_24h: number } | undefined;
}

const stateLabel: Record<string, string> = {
	new: "new",
	learning: "learning",
	relearning: "relearning",
	review: "review",
	suspended: "suspended",
};

export default function ContextBar(props: ContextBarProps) {
	const { m } = props;

	return (
		<div class={styles.contextBar}>
			<div class={styles.ctxStats}>
				{/* 当前卡编号与状态 */}
				<Show when={m.item()}>
					{(it) => (
						<span class={styles.ctxStat} title="当前卡片">
							#{it().id} · {stateLabel[it().state] ?? it().state}
						</span>
					)}
				</Show>

				<Show when={m.estimatedTotal() > 0}>
					<span class={styles.ctxStat}>
						≈{m.estimatedTotal()} 次
						<Show when={m.estRemaining() >= 60}>
							· ~{Math.round(m.estRemaining() / 60)}m
						</Show>
						<Show when={m.estRemaining() > 0 && m.estRemaining() < 60}>
							· ~{m.estRemaining()}s
						</Show>
					</span>
				</Show>
				<Show when={props.upcomingCounts}>
					{(u) => (
						<span class={styles.ctxStat}>
							8h:{u().within_8h} · 24h:{u().within_24h}
						</span>
					)}
				</Show>
			</div>

			<div class={styles.ctxActions}>
				<Show
					when={m.editing()}
					fallback={
						<Button variant="ghost" size="sm" onClick={m.startEdit}>
							编辑
						</Button>
					}
				>
					<Button variant="primary" size="sm" onClick={m.saveEdit}>
						保存
					</Button>
					<Button variant="ghost" size="sm" onClick={() => m.setEditing(false)}>
						取消
					</Button>
				</Show>
			</div>
		</div>
	);
}
