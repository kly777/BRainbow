// ── 上传前读媒体时长（浏览器就能读，不必等后端） ──
//
// 背景：`file.duration_ms` 这一列一直存在，但**从来没有人写过** —— 上传路径只解析
// 图片尺寸（service.rs 的 extract_image_dimensions），视频/音频的时长恒为 NULL，
// 于是列表与详情页的"时长"永远是空的。
//
// 为什么在前端读：上传前文件就在客户端手上，`loadedmetadata` 一次就有值，**不占
// 服务端 CPU**，也不用为一个展示字段在上传路径里起子进程（上传是流式的，视频上限 4GB）。
//
// 读不出来是正常的（浏览器解不了这个容器：mkv / avi / wmv 常见）→ 返回 undefined，
// 库里留空即可；真正需要时由视频海报帧那条路顺带用 ffprobe 补。

/** 读 metadata 的超时：只需读文件头，3 秒还没出来就放弃（别让上传卡在读时长上） */
const READ_TIMEOUT_MS = 3000;

/** 只有音视频才读：给图片也走一遍解码纯属浪费 */
export function mediaKind(mime: string): "video" | "audio" | undefined {
	if (mime.startsWith("video/")) return "video";
	if (mime.startsWith("audio/")) return "audio";
	return undefined;
}

/**
 * 秒 → 毫秒。只接受有限正值：
 * 流式容器（以及还没读到头的时候）duration 是 `Infinity` / `NaN`，
 * 直接乘 1000 会写成 `Infinity`（JSON里是 null）或 `NaN`。
 */
export function toMillis(seconds: number): number | undefined {
	if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
	return Math.round(seconds * 1000);
}

export interface MediaDurationDeps {
	/** 读超时（jsdom 里调到几毫秒，免得测试等 3 秒） */
	timeoutMs?: number;
	/** 元素工厂：只在测试里注入假元素（jsdom 不解码媒体） */
	createElement?: (kind: "video" | "audio") => HTMLMediaElement;
}

/** 读本地文件的媒体时长（毫秒）。非音视频、读不出、超时 → undefined */
export function readMediaDuration(
	file: File,
	deps: MediaDurationDeps = {},
): Promise<number | undefined> {
	const kind = mediaKind(file.type);
	if (!kind) return Promise.resolve(undefined);

	return new Promise((resolve) => {
		const makeElement =
			deps.createElement ??
			((k: "video" | "audio") => document.createElement(k));
		const el = makeElement(kind);

		// jsdom 没有 createObjectURL；没有它就只能当作读不出（上传照常进行）
		const canUrl = typeof URL.createObjectURL === "function";
		const url = canUrl ? URL.createObjectURL(file) : "";

		let settled = false;
		const finish = (value?: number) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			// 主动断开解码，别把文件句柄/内存留到 GC
			el.removeAttribute("src");
			el.load();
			if (canUrl) URL.revokeObjectURL(url);
			resolve(value);
		};

		const timer = setTimeout(() => finish(), deps.timeoutMs ?? READ_TIMEOUT_MS);
		el.preload = "metadata";
		el.addEventListener("loadedmetadata", () => finish(toMillis(el.duration)));
		el.addEventListener("error", () => finish());
		el.src = url;
	});
}
