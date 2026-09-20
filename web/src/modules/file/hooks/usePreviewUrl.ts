// ── 私密文件的可预览 URL ──
//
// 浏览器给 <img src> / <video src> 发请求时不会附带 Authorization，
// 私密文件的内容接口会 401。因此私密文件走"带凭据 fetch → blob → objectURL"，
// 公开文件直接用原 URL（不额外请求，也不占内存）。
//
// 失败要给出口：此前 `.catch(() => setResolved(undefined))` 把错误吞掉，调用方的
// fallback 只会显示"正在加载私密文件…"——请求已经失败了，却永远停在"正在加载"。
// 现在返回结构化的错误 + retry，由调用方（PreviewMedia / ImageLightbox）呈现。

import { buildHeaders } from "@shared/api";
import { createEffect, createSignal, onCleanup } from "solid-js";
import {
	httpPreviewError,
	networkPreviewError,
	type PreviewErrorInfo,
} from "../lib/previewError.ts";

/** 私密文件换 blob 的失败（公开文件不走这条路，恒为 undefined） */
export interface PreviewUrlState {
	url: () => string | undefined;
	error: () => PreviewErrorInfo | undefined;
	retry: () => void;
}

/**
 * 返回可直接放进 src 的 URL：
 * - 公开文件：原 URL（同步就有值）
 * - 私密文件：blob URL（异步；加载中/失败为 undefined）
 */
export function usePreviewUrl(
	url: () => string,
	isPrivate: () => boolean,
): PreviewUrlState {
	const [resolved, setResolved] = createSignal<string>();
	const [error, setError] = createSignal<PreviewErrorInfo | undefined>(
		undefined,
	);
	// 计数器而非布尔：retry 时上一轮还没回来的响应不能覆盖新一轮的结果
	const [attempt, setAttempt] = createSignal(0);

	createEffect(() => {
		const src = url();
		attempt(); // retry 时重跑这个 effect
		setError(undefined);

		if (!isPrivate()) {
			setResolved(src);
			return;
		}

		setResolved(undefined);
		let cancelled = false;
		let objectUrl: string | undefined;

		fetch(src, { headers: buildHeaders() })
			.then((resp) => {
				if (!resp.ok) {
					// 带上状态码，交给分类函数决定"重试有没有意义"
					throw Object.assign(new Error(`HTTP ${resp.status}`), {
						status: resp.status,
					});
				}
				return resp.blob();
			})
			.then((blob) => {
				if (cancelled) return;
				objectUrl = URL.createObjectURL(blob);
				setResolved(objectUrl);
			})
			.catch((e: unknown) => {
				if (cancelled) return;
				const status = (e as { status?: number }).status;
				setError(
					typeof status === "number"
						? httpPreviewError(status)
						: networkPreviewError(),
				);
			});

		onCleanup(() => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		});
	});

	return {
		url: resolved,
		error,
		retry: () => setAttempt((n) => n + 1),
	};
}
