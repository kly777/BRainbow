// ── 记忆复习模块的纯计算辅助和常量 ──

/** 指数移动平均衰减因子 */
export const ALPHA = 0.2;
/** 每轮最少拉取数 */
export const MIN_LIMIT = 3;
/** 每轮最多拉取数 */
export const MAX_LIMIT = 15;
/** 默认拉取数 */
export const DEFAULT_LIMIT = 7;

/** 动态队列大小：基于评分 EMA 计算 */
export function calcMaxLearning(avg: number): number {
	return Math.round(MIN_LIMIT + ((avg - 1) / 3) * (MAX_LIMIT - MIN_LIMIT));
}

/** 平均单张卡耗时（秒） */
export function calcAvgCardTime(durations: readonly number[]): number {
	if (durations.length === 0) return 0;
	return durations.reduce((a, b) => a + b, 0) / durations.length;
}
