// ── 截止时间展示（相对时间 + 逾期标记）──

export interface DueLabel {
	text: string;
	/** 逾期（界面给 ⚠ 与描边，不靠颜色单独承载信息 —— WCAG 1.4.1） */
	overdue: boolean;
}

/** 同一本地日（用户看的是自己的日历，不是 UTC 日期） */
function sameLocalDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/** `2026-10-09T15:00:00+00:00` → `逾期 2 天` / `今天 15:00` / `还剩 3 天` / `10-20` */
export function formatDue(
	dueAt: string | null,
	now = new Date(),
): DueLabel | null {
	if (!dueAt) return null;
	const due = new Date(dueAt);
	if (Number.isNaN(due.getTime())) return null;

	const time = `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`;
	if (sameLocalDay(due, now)) {
		return { text: `今天 ${time}`, overdue: false };
	}
	if (due < now) {
		const days = Math.max(
			1,
			Math.floor((now.getTime() - due.getTime()) / 86_400_000),
		);
		return { text: `逾期 ${days} 天`, overdue: true };
	}
	const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
	if (days <= 7) {
		return { text: `还剩 ${days} 天`, overdue: false };
	}
	return {
		text: `${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`,
		overdue: false,
	};
}
