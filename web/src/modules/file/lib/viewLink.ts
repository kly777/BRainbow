// ── 查看器内部状态的深链（纯函数） ──
//
// 让"我读到第 12 章""我在看第 2 张表""我看到偏移 4096 了"能进 URL —— 于是
// **刷新不丢位置、能加书签、能把这一页发给别人**。
//
// 格式是**一个参数**：`?view=<查看器id>:<状态串>`
//   ?view=epub:12      → epub 的第 13 章（0 基）
//   ?view=xlsx:1       → 第 2 张表
//   ?view=hex:4096     → 十六进制从 4096 字节起
//
// 为什么是"一个参数 + id 前缀"而不是 `?chapter=12&sheet=1`：
//   1. 一页只可能有一个查看器，塞一堆各自的键名会让 URL 变成杂物柜；
//   2. id 决定归属 —— 不匹配的查看器直接忽略，不会出现"这个参数是给谁的"的猜谜；
//   3. `Viewer.id` 在 types.ts 里本来就预留给这个用途（"契约测试标注、以及将来的 ?view= 深链"）。
//
// 状态串的含义**由各查看器自己定义**（它知道自己有哪些可序列化的位置），
// 这里只负责拆包与两个通用的数字解析。

/** 拆开 `id:payload`；没有参数、没有冒号、id 为空都返回 undefined */
export function parseViewParam(
	raw: string | undefined,
): { id: string; payload: string } | undefined {
	if (!raw) return undefined;
	const at = raw.indexOf(":");
	if (at <= 0) return undefined;
	const id = raw.slice(0, at);
	const payload = raw.slice(at + 1);
	return payload === "" ? undefined : { id, payload };
}

/** 该查看器在这次 URL 里的状态串（不是它的就返回 undefined） */
export function viewStateOf(
	raw: string | undefined,
	viewerId: string,
): string | undefined {
	const parsed = parseViewParam(raw);
	return parsed?.id === viewerId ? parsed.payload : undefined;
}

/** 组装参数值（写入 URL 用） */
export function buildViewParam(
	viewerId: string,
	payload: string | number,
): string {
	return `${viewerId}:${payload}`;
}

/**
 * 解析"第几项/第几字节"这类非负整数状态。
 *
 * `max` 给了就做上限校验（越界当没给 —— 比如链接是上一版文件的第 30 章，而这份只有 12 章）：
 * 越界的深链宁可从头开始，也不要跳到不存在的位置上。
 */
export function parseIndexPayload(
	payload: string | undefined,
	max?: number,
): number | undefined {
	// **只认十进制数字**（`/^\d+$/`）：`Number()` 会把 `1e3`、`0x10`、` 12 ` 都收下，
	// 而 URL 里出现这些几乎都是笔误或损坏 —— 那时"当没给"（从头开始）比
	// 静悄悄跳到偏移 1000 安全
	if (!payload || !/^\d+$/.test(payload)) return undefined;
	const value = Number(payload);
	if (max !== undefined && value >= max) return undefined;
	return value;
}
