// ── 记忆复习模块的纯计算辅助和常量 ──

/** 指数移动平均衰减因子 */
export const ALPHA = 0.2;
/** 每轮最少拉取数 */
export const MIN_LIMIT = 3;
/** 每轮最多拉取数 */
export const MAX_LIMIT = 15;
/** 默认拉取数 */
export const DEFAULT_LIMIT = 7;
/** 没有历史耗时数据时的单卡耗时先验（秒） */
export const DEFAULT_CARD_TIME_SECS = 20;
/** 先验的伪样本权重：前几张实测卡不会瞬间拉偏预估 */
export const CARD_TIME_PRIOR_WEIGHT = 4;

/** 动态队列大小：基于评分 EMA 计算 */
export function calcMaxLearning(avg: number): number {
	return Math.round(MIN_LIMIT + ((avg - 1) / 3) * (MAX_LIMIT - MIN_LIMIT));
}

/** 先验加权平均单卡耗时：随实测样本增多平滑收敛，避免第一张卡让预估跳变 */
export function calcAvgCardTime(durations: readonly number[]): number {
	const sum = durations.reduce((a, b) => a + b, 0);
	return (
		(DEFAULT_CARD_TIME_SECS * CARD_TIME_PRIOR_WEIGHT + sum) /
		(CARD_TIME_PRIOR_WEIGHT + durations.length)
	);
}
