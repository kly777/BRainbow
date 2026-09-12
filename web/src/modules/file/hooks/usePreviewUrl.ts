// ── 私密文件的可预览 URL ──
//
// 浏览器给 <img src> / <video src> 发请求时不会附带 Authorization，
// 私密文件的内容接口会 401。因此私密文件走"带凭据 fetch → blob → objectURL"，
// 公开文件直接用原 URL（不额外请求，也不占内存）。

import { buildHeaders } from "@shared/api";
import { createEffect, createSignal, onCleanup } from "solid-js";

/**
 * 返回可直接放进 src 的 URL：
 * - 公开文件：原 URL（同步就有值）
 * - 私密文件：blob URL（异步；加载中/失败为 undefined）
 */
export function usePreviewUrl(url: () => string, isPrivate: () => boolean) {
	const [resolved, setResolved] = createSignal<string>();

	createEffect(() => {
		const src = url();
		if (!isPrivate()) {
			setResolved(src);
			return;
		}

		setResolved(undefined);
		let cancelled = false;
		let objectUrl: string | undefined;

		fetch(src, { headers: buildHeaders() })
			.then((resp) => {
				if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
				return resp.blob();
			})
			.then((blob) => {
				if (cancelled) return;
				objectUrl = URL.createObjectURL(blob);
				setResolved(objectUrl);
			})
			.catch(() => {
				if (!cancelled) setResolved(undefined);
			});

		onCleanup(() => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		});
	});

	return resolved;
}
