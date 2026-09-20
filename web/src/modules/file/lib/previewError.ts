// ── 预览失败的分类：决定"下一步给用户什么" ──
//
// 原先每个查看器的失败态都只有一句 `预览失败：HTTP 500`，用户没有下一步动作 ——
// 重试？下载？还是这文件本来就打不开？只能切走再切回来（切文件还得回列表页）。
//
// 这里只回答两个问题：**重试有没有意义**、**还能做什么**。
// 分界线是"换个时刻再试会不会不一样"：
//   - 网络中断、超时、5xx  → 会（重试）
//   - 4xx（内容问题/权限/超限/丢失）→ 不会，此时给下载入口与说明更诚实
//
// 后端的 400 会带可读的中文 message（如"文件超过 32MB，不在服务端解析预览"），
// 直接透给用户比任何前端措辞都准。

/** 一次预览失败的全部信息（渲染层据此决定按钮） */
export interface PreviewErrorInfo {
	/** 给用户看的一句话 */
	message: string;
	/** 重试有意义吗（决定要不要出「重试」按钮） */
	retryable: boolean;
	/** 补充说明：还能做什么（可选） */
	hint?: string;
}

/**
 * HTTP 状态码 → 错误信息。`backendMessage` 是后端 `{code, message}` 里的原文
 * （`usePreviewDoc` 会读出来），有就优先用它。
 */
export function httpPreviewError(
	status: number,
	backendMessage?: string,
): PreviewErrorInfo {
	// 后端把"解析不了 / 太大"这类内容问题的原因写在 message 里，比前端猜准
	if (status === 400) {
		return {
			message: backendMessage ?? "这个文件无法解析预览",
			retryable: false,
			hint: "可下载后用本地工具打开",
		};
	}
	if (status === 401 || status === 403) {
		return { message: "没有权限查看这个文件", retryable: false };
	}
	if (status === 404) {
		return {
			message: "文件内容已丢失",
			retryable: false,
			hint: "数据库里仍保留记录，但磁盘上找不到文件",
		};
	}
	// 限流/超时/服务端出错：换一会儿再试有意义
	if (status === 408 || status === 425 || status === 429 || status >= 500) {
		return {
			message: `服务暂时不可用（HTTP ${status}）`,
			retryable: true,
		};
	}
	// 其余 4xx（如 416 分段越界）：重试同一个请求还是同样结果
	if (status >= 400) {
		return {
			message: backendMessage ?? `请求被拒绝（HTTP ${status}）`,
			retryable: false,
			hint: "可下载后用本地工具打开",
		};
	}
	// 2xx/3xx 走到这里说明是解析/解码层面的问题（内容对不上号）
	return { message: "内容无法解析", retryable: true };
}

/** fetch 本身抛错（断网、DNS、被 abort 之外的异常） */
export function networkPreviewError(): PreviewErrorInfo {
	return {
		message: "网络错误，没能取到文件内容",
		retryable: true,
		hint: "检查网络后重试",
	};
}
