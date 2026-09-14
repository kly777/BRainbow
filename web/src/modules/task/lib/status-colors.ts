// ── 任务状态 → 设计令牌名（单一来源）──
//
// 为什么要有这个文件：看板（TaskKanban）与依赖图（dag-render）都要「按状态取色」，
// 改造前各存了一份字面量表，而且**取值互相漂移**（backlog / archived 两处互换）。
// 依赖图那份还多写了一个右括号（`"var(--t-color-accent))"`）再用 `slice(4, -1)`
// 手工剥壳，剥完仍留着 `)`，于是 4 个状态色全部读成空串、Canvas 静默忽略非法颜色，
// 整张图退化成黑色而没有任何构建期 / 测试期提示。
//
// 这里只登记**裸令牌名**，由消费方各自转换：
//   CSS 侧（看板列色）：`var(${name})`
//   Canvas 侧（依赖图）：readToken(name)
//
// 取值沿用看板那一份：它是四处里唯一一直正常显示、用户一直在看的值；
// 依赖图那份从未成功渲染过，因此取看板值不构成可见变化。
// 另有两处 CSS 徽章（TaskList / EditTaskModal 的 .status-*）对小圆点用了
// `--t-color-border` 表达"未激活"，属另一套视觉，未纳入本表。

import type { TokenName } from "@shared/styles";

export type TaskStatusKey = "backlog" | "active" | "completed" | "archived";

export const STATUS_TOKENS: Record<TaskStatusKey, TokenName> = {
	backlog: "--t-color-ink-muted",
	active: "--t-color-accent",
	completed: "--t-color-success",
	archived: "--t-color-ink-faint",
};

/** 未知状态回退到 muted（与改造前依赖图的兜底意图一致） */
export function statusToken(status: string): TokenName {
	return STATUS_TOKENS[status as TaskStatusKey] ?? "--t-color-ink-muted";
}
