// ── 标签输入的纯逻辑：候选过滤 / 精确命中 / Enter 落点 ──
//
// 抽出来的理由：file / bookmark / mem 三处标签输入各写了一遍同样的三件判断，
// 且其中一处（mem）的 Enter 落点与另两处不一致 —— 差异不是刻意的领域差异，
// 而是三份拷贝各自演化的结果。纯函数放这里，三处共用，行为只有一处定义。

/** 标签候选的最小形状：只要能按 name 匹配即可（id/count 由调用方保留） */
export interface TagCandidate {
	name: string;
}

/**
 * 候选列表：query 为空时返回空数组，否则剔除已选项、按 name 包含匹配（忽略大小写）。
 *
 * 空 query 返回空是刻意的：调用方据此决定"不展示下拉"，避免刚聚焦就弹一屏标签。
 */
export function filterTagOptions<T extends TagCandidate>(
	options: readonly T[],
	query: string,
	isSelected: (option: T) => boolean,
): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	return options.filter(
		(option) => !isSelected(option) && option.name.toLowerCase().includes(q),
	);
}

/** query 是否已精确命中某个候选（忽略大小写）—— 命中时不再提示"创建/使用" */
export function hasExactTagMatch(
	options: readonly TagCandidate[],
	query: string,
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return false;
	return options.some((option) => option.name.toLowerCase() === q);
}

/** Enter 的落点（三处标签输入同一套规则） */
export type TagEnterTarget<T> =
	| { kind: "option"; option: T }
	| { kind: "text"; text: string };

/**
 * Enter 键该取哪个值：
 * 1. query 精确命中**候选**里的某个 → 取那个候选（用户打完了名字，就该拿到它，
 *    而不是候选列表里第一个"名字里含它"的标签）；
 * 2. 命中的是**已知但已被选**的同名标签 → 回落到输入原文，让调用方去重
 *    （那是"什么都不该发生"，不能顺手把别的候选塞进去）；
 * 3. 否则有候选 → 取第一条（下拉里高亮的那条）；
 * 4. 都没有 → 取输入原文（后端保存时自动建标签）。
 *
 * query 为空返回 null（无事可做）。
 *
 * 为什么要分 `suggestions` 与 `known` 两个列表：候选是**剔过已选项**的，
 * 于是"用户打的是已选中标签的全名"这件事在候选里查不出来 —— 而它恰恰是
 * 最需要区分的一档。
 */
export function tagEnterTarget<T extends TagCandidate>(
	suggestions: readonly T[],
	query: string,
	known: readonly TagCandidate[] = suggestions,
): TagEnterTarget<T> | null {
	const q = query.trim();
	if (!q) return null;
	const lower = q.toLowerCase();
	const exact = suggestions.find(
		(option) => option.name.toLowerCase() === lower,
	);
	if (exact) return { kind: "option", option: exact };
	if (known.some((option) => option.name.toLowerCase() === lower)) {
		return { kind: "text", text: q };
	}
	const first = suggestions[0];
	if (first) return { kind: "option", option: first };
	return { kind: "text", text: q };
}
