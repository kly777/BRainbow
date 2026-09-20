// ── 3D 模型预览的格式判定（纯函数，可直测） ──
//
// 渲染交给 three.js（见 viewers/ModelViewer.tsx）—— 网格要处理材质/光照/法线/相机交互，
// 自己写既没收益也修不动。这里只放"这个文件该用哪个 loader""它能不能单文件加载"
// 这类纯判断，好在 jsdom 里测。

export type ModelFormat = "glb" | "gltf" | "stl" | "obj";

/** 支持哪些扩展名（注册表也用它认领；`.ply` 归泼溅查看器，不在这里） */
export function modelFormatOf(name: string): ModelFormat | undefined {
	const matched = /\.(glb|gltf|stl|obj)$/i.exec(name.trim());
	return matched?.[1]?.toLowerCase() as ModelFormat | undefined;
}

/**
 * `.gltf`（JSON）是否引用了外部文件。
 *
 * 单文件预览加载不了同目录下的 `.bin` / 贴图（它们是另外上传的文件，地址对不上），
 * 所以遇到这种要**提前**给出准确提示，而不是让 three 去 fetch 一串 404。
 * `data:` 内联的缓冲区不算外部文件。
 */
export function gltfNeedsExternalFiles(json: string): boolean {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return false; // 不是合法 JSON：交给 loader 报错，别在这里抢话
	}
	const buffers = (parsed as { buffers?: { uri?: string }[] }).buffers;
	if (!Array.isArray(buffers)) return false;
	return buffers.some(
		(buffer) =>
			typeof buffer?.uri === "string" && !buffer.uri.startsWith("data:"),
	);
}

/** 模型文件大小上限（沿用它：网格带贴图时几十 MB 常见，再大就该本地看） */
export const MODEL_MAX_BYTES = 256 * 1024 * 1024;
