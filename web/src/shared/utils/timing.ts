// ── 定时类工具：集中管理散落的 setTimeout 魔法数 ──

/** 失焦延迟关闭下拉的宽限毫秒：给选项的 mousedown → click 留出注册时间 */
export const BLUR_CLOSE_DELAY_MS = 200;

/** 搜索防抖默认等待：输入停止后多久才真正发请求 */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * 防抖包装：连续调用只保留最后一次，静默 delayMs 后执行 fn。
 * 返回函数带 .cancel()；组件卸载时请调用（通常配 onCleanup）。
 * 异步请求另需竞态保护（序号比对），见 useChatPage/usePaletteSearch。
 */
export function debounce<A extends unknown[]>(
	fn: (...args: A) => void,
	delayMs = SEARCH_DEBOUNCE_MS,
): ((...args: A) => void) & { cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const run = (...args: A): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			fn(...args);
		}, delayMs);
	};
	run.cancel = () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};
	return run;
}

/**
 * onBlur 场景专用：延迟关闭下拉，避免点击选项先触发的 blur 把点击吞掉。
 * 返回 { schedule, cancel }：schedule 触发延迟关闭；cancel 取消挂起的关闭。
 */
export function blurClose(
	close: () => void,
	delayMs = BLUR_CLOSE_DELAY_MS,
): { schedule: () => void; cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		schedule: () => {
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = undefined;
				close();
			}, delayMs);
		},
		cancel: () => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
		},
	};
}
