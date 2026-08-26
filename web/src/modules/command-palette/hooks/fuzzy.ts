// ── 模糊匹配工具 ──
// 组合策略：子串精确匹配 > 子序列匹配 > 编辑距离。
// 用于命令面板导航/指令搜索，容忍拼写错误。

/** 结果：匹配成功 + 排序用的分数（越低越好） */
export interface FuzzyResult {
	matched: boolean;
	score: number;
}

/** 子序列匹配：query 的每个字符按序出现在 target 中 */
function subsequenceScore(q: string, t: string): number {
	let qi = 0;
	let ti = 0;
	let gaps = 0;
	let lastMatch = -1;

	while (qi < q.length && ti < t.length) {
		if (q[qi] === t[ti]) {
			if (lastMatch >= 0) gaps += ti - lastMatch - 1;
			lastMatch = ti;
			qi++;
		}
		ti++;
	}
	if (qi < q.length) return Number.POSITIVE_INFINITY;
	return gaps;
}

/** Damerau-Levenshtein 距离（含相邻换位） */
function levenshtein(a: string, b: string): number {
	const la = a.length;
	const lb = b.length;
	if (la === 0) return lb;
	if (lb === 0) return la;

	const d: number[][] = Array.from({ length: la + 1 }, () =>
		new Array(lb + 1).fill(0),
	);

	for (let i = 0; i <= la; i++) d[i][0] = i;
	for (let j = 0; j <= lb; j++) d[0][j] = j;

	for (let i = 1; i <= la; i++) {
		for (let j = 1; j <= lb; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			d[i][j] = Math.min(
				d[i - 1][j] + 1, // 删除
				d[i][j - 1] + 1, // 插入
				d[i - 1][j - 1] + cost, // 替换
			);
			// 相邻换位（Damerau）
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
			}
		}
	}
	return d[la][lb];
}

/**
 * 模糊匹配评分。
 *
 * 返回 FuzzyResult：matched 表示是否命中，score 越低越好。
 * 策略优先级：
 *   1. 子串精确包含 → score 0
 *   2. 子序列匹配 → score = gap 数（越紧凑越好）
 *   3. 编辑距离 → 距离 ≤ 阈值时按距离打分
 *
 * @param query  用户输入（已 toLowerCase）
 * @param target 候选文本（已 toLowerCase）
 * @param maxDistance 编辑距离最大容许值，默认 2
 */
export function fuzzyMatch(
	query: string,
	target: string,
	maxDistance = 2,
): FuzzyResult {
	if (!query) return { matched: true, score: 0 };

	// 1. 子串精确匹配
	const idx = target.indexOf(query);
	if (idx >= 0) {
		return { matched: true, score: -100 + idx };
	}

	// 2. 子序列匹配（字符按序出现，容忍中间插入其他字符）
	const seqScore = subsequenceScore(query, target);
	if (seqScore < Number.POSITIVE_INFINITY) {
		return { matched: true, score: seqScore };
	}

	// 3. 编辑距离（容忍拼写错误：增/删/改/换位）
	const dist = levenshtein(query, target);
	if (dist <= maxDistance) {
		return { matched: true, score: 100 + dist };
	}

	// 4. 对较长 target 也尝试子串窗口编辑距离（"home" 匹配 "homepage"）
	if (target.length > query.length) {
		let bestDist = Number.POSITIVE_INFINITY;
		for (let i = 0; i <= target.length - query.length; i++) {
			const window = target.slice(i, i + query.length);
			const d = levenshtein(query, window);
			if (d < bestDist) bestDist = d;
			if (bestDist === 0) break;
		}
		if (bestDist <= maxDistance) {
			return { matched: true, score: 200 + bestDist };
		}
	}

	return { matched: false, score: Number.POSITIVE_INFINITY };
}

/**
 * 模糊过滤 + 排序：返回按匹配质量排序后的元素列表。
 * @param items  候选项
 * @param query  搜索词
 * @param getText 从候选项提取可搜索文本
 */
export function fuzzyFilter<T>(
	items: T[],
	query: string,
	getText: (item: T) => string[],
): T[] {
	const q = query.toLowerCase();
	const scored: { item: T; score: number }[] = [];

	for (const item of items) {
		let best: FuzzyResult = { matched: false, score: Number.POSITIVE_INFINITY };
		for (const text of getText(item)) {
			const r = fuzzyMatch(q, text.toLowerCase());
			if (r.matched && r.score < best.score) {
				best = r;
			}
		}
		if (best.matched) {
			scored.push({ item, score: best.score });
		}
	}

	scored.sort((a, b) => a.score - b.score);
	return scored.map((s) => s.item);
}
