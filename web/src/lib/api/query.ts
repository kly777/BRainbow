// ── 请求辅助：query 参数构建 / 超时信号 ──

/** 构建 URL 查询串（跳过空值），返回值以 ? 开头（空串表示无参数） */
export function buildQuery(params: Record<string, unknown>): string {
	const sp = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") continue;
		sp.set(key, String(value));
	}
	const qs = sp.toString();
	return qs ? `?${qs}` : "";
}

/**
 * 生成带超时的 AbortSignal：与调用方 signal 合并，任一触发即取消。
 * 超时时间会随 AbortSignal.timeout 传播（调用方捕获 NetworkError.canceled 判断是否超时）。
 */
export function withTimeout(
	ms: number,
	signal?: AbortSignal | null,
): { signal: AbortSignal; timer: ReturnType<typeof setTimeout> } {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	if (signal) {
		if (signal.aborted) controller.abort();
		else
			signal.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
	}
	return { signal: controller.signal, timer };
}
