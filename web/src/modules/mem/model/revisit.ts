// ── 会话内重插（revisit）的纯计算 ──
//
// 目标：评分 Again/Hard 后，当前卡不是直接消失，而是隔几张后再次出现；
// 难卡在同一轮获得更多曝光，同时避免同一张卡紧挨着刷屏。

/** 同一张卡每轮最多重插次数（超过后本轮不再出现） */
export const MAX_REVISITS = 3;

/** Again 重插间隔：1~2 张之后（按 card id 确定性分散，避免测试抖动） */
export function againGap(cardId: number): number {
	return 1 + (cardId % 2);
}

/** Hard 重插间隔：4~6 张之后 */
export function hardGap(cardId: number): number {
	return 4 + (cardId % 3);
}

/** 评分对应的重插间隔；0 表示不重插（Good/Easy 正常消费） */
export function revisitGapFor(rating: number, cardId: number): number {
	if (rating === 1) return againGap(cardId);
	if (rating === 2) return hardGap(cardId);
	return 0;
}

/** 当前卡是否已经达到重插上限（count 为本轮已重插次数） */
export function shouldDropRevisit(count: number, max = MAX_REVISITS): boolean {
	return count >= max;
}

/** 把 currentIndex 的卡移动 gap 张之后；返回新队列与新的当前索引 */
export function insertRevisit<T>(
	queue: readonly T[],
	currentIndex: number,
	gap: number,
): { next: T[]; nextIndex: number } {
	if (queue.length <= 1) {
		return { next: [...queue], nextIndex: currentIndex };
	}
	const idx = Math.min(Math.max(currentIndex, 0), queue.length - 1);
	const next = [...queue];
	const [item] = next.splice(idx, 1);
	const insertAt = Math.min(idx + Math.max(gap, 1), next.length);
	next.splice(insertAt, 0, item as T);
	return { next, nextIndex: Math.min(idx, next.length - 1) };
}
