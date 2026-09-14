// ── 查看器注册表契约 ──
//
// 两条规则：
//  1. **表驱动命中**：给定一条文件记录，必须命中预期的查看器 id（undefined = 走下载兜底）。
//     顺序即优先级，所以泛化规则（text/*）排在具体规则之后这件事也被钉住。
//  2. **白名单覆盖**：后端 ALLOWED_MIMES 里的每个 mime 在前端都要有明确归属——要么有
//     查看器，要么显式记在 EXPECTED 里标成 null（"这个类型就是只下载"）。为了让这份镜像
//     不靠人工同步，第 2 条直接解析 service.rs：后端加格式 → 这条测试失败 → 逼一次
//     "要不要做查看器"的决定，而不是等用户上传完看到一块空白预览区。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FileCategory, FileItem } from "../api.ts";
import { pickViewer } from "./registry.ts";
import { item as file } from "./test-fixtures.ts";

// vitest 从 web/ 启动（同 shared/styles/css-modules-contract.test.ts 的路径假设）
const SERVICE_RS = join(process.cwd(), "../src/modules/file/service.rs");

/** 按类别造一条记录（后端白名单的 category 列值就是 FileCategory 的字符串） */
const ofCategory = (mime: string, category: string, name?: string): FileItem =>
	file({
		mime_type: mime,
		file_category: category as FileCategory,
		original_name: name ?? `a.${mime.split("/")[1]}`,
	});

describe("查看器注册表：命中规则", () => {
	const cases: Array<[string, FileItem, string | undefined]> = [
		["png", ofCategory("image/png", "image", "a.png"), "image"],
		[
			"svg（无魔数，归 image 类别但本质是 XML）",
			ofCategory("image/svg+xml", "image", "a.svg"),
			"image",
		],
		[
			"tiff（浏览器多半渲染不了，由查看器的 onError 兜底）",
			ofCategory("image/tiff", "image", "a.tiff"),
			"image",
		],
		["mp4", ofCategory("video/mp4", "video", "a.mp4"), "video"],
		[
			"webm 音频（与 webm 视频同扩展名，按 mime 分流）",
			ofCategory("audio/webm", "audio", "a.webm"),
			"audio",
		],
		["pdf", ofCategory("application/pdf", "document", "a.pdf"), "pdf"],
		[
			"text/markdown",
			ofCategory("text/markdown", "document", "a.md"),
			"markdown",
		],
		["text/html", ofCategory("text/html", "document", "a.html"), "html"],
		["text/csv", ofCategory("text/csv", "document", "a.csv"), "csv"],
		[
			"源码（后端按扩展名归一成 text/plain，靠扩展名走高亮）",
			ofCategory("text/plain", "document", "main.rs"),
			"code",
		],
		[
			"Dockerfile（无扩展名，按文件名认语言）",
			ofCategory("text/plain", "document", "Dockerfile"),
			"code",
		],
		["纯文本", ofCategory("text/plain", "document", "a.txt"), "text"],
		[
			"docx（后端白名单收了，但前端还没有查看器）",
			ofCategory(
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				"document",
				"a.docx",
			),
			undefined,
		],
		["压缩包", ofCategory("application/zip", "other", "a.zip"), "hex"],
		[
			"3DGS 高斯泼溅（.ply 按扩展名认领，内容由查看器解析）",
			ofCategory("application/octet-stream", "other", "模型.ply"),
			"splat",
		],
		[
			"大写扩展名的 .PLY 同样认",
			ofCategory("application/octet-stream", "other", "SCENE.PLY"),
			"splat",
		],
		[
			"点云 .ply 也走泼溅查看器（查看器内部按有无高斯参数分流）",
			ofCategory("application/octet-stream", "other", "scan.ply"),
			"splat",
		],
		[
			"字幕（MIME 是 application/x-subrip，归 other 但内容是文本）",
			ofCategory("application/x-subrip", "other", "英语听力.srt"),
			"plain-text-name",
		],
		[
			"播放列表（m3u 同理）",
			ofCategory("application/vnd.apple.mpegurl", "other", "歌单.m3u"),
			"plain-text-name",
		],
		[
			"内容缺失的文件（照样选查看器，缺失提示由宿主渲染）",
			file({ missing: true, mime_type: "image/png", file_category: "image" }),
			"image",
		],
	];

	for (const [name, item, expected] of cases) {
		it(`${name} → ${expected ?? "下载兜底"}`, () => {
			expect(pickViewer(item)?.id).toBe(expected);
		});
	}
});

describe("查看器注册表：后端白名单覆盖", () => {
	/** 解析 service.rs 的 ALLOWED_MIMES 块，得到后端认的全部 (mime, category) */
	function backendAllowedMimes(): Array<{ mime: string; category: string }> {
		const src = readFileSync(SERVICE_RS, "utf8");
		const start = src.indexOf("const ALLOWED_MIMES");
		if (start < 0)
			throw new Error(
				`在 ${SERVICE_RS} 里找不到 ALLOWED_MIMES——表结构变了？请同步更新本测试`,
			);
		const end = src.indexOf("];", start);
		const block = src.slice(start, end);
		const out: Array<{ mime: string; category: string }> = [];
		for (const m of block.matchAll(/"([\w.+-]+\/[\w.+-]+)"\s*,\s*"(\w+)"/g)) {
			out.push({ mime: m[1], category: m[2] });
		}
		return out;
	}

	/**
	 * 后端每个白名单 mime 在前端的归属：查看器 id，或 null = 明确只给下载。
	 * 新增后端格式时**必须**在这里给出一行（哪怕写 null），否则下面的测试会失败。
	 */
	const EXPECTED: Record<string, string | null> = {
		"image/png": "image",
		"image/jpeg": "image",
		"image/gif": "image",
		"image/webp": "image",
		"image/bmp": "image",
		"image/tiff": "image",
		"image/svg+xml": "image",
		"video/mp4": "video",
		"video/webm": "video",
		"video/ogg": "video",
		"video/quicktime": "video",
		"audio/mpeg": "audio",
		"audio/ogg": "audio",
		"audio/wav": "audio",
		"audio/webm": "audio",
		"audio/flac": "audio",
		"audio/aac": "audio",
		"application/pdf": "pdf",
		"text/plain": "text",
		"text/html": "html",
		"text/csv": "csv",
		"text/markdown": "markdown",
		// Office 二进制文档：白名单收了但前端只给下载（查看器待补，见 doc/file-service.md）
		"application/msword": null,
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
			null,
		"application/vnd.ms-excel": null,
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": null,
	};

	it("service.rs 的 ALLOWED_MIMES 能解析出来（解析失败要吵，不能静默放过）", () => {
		expect(backendAllowedMimes().length).toBeGreaterThanOrEqual(20);
	});

	it("每个白名单 mime 都有明确归属（查看器或显式 null）", () => {
		const missing: string[] = [];
		for (const { mime, category } of backendAllowedMimes()) {
			if (!(mime in EXPECTED)) {
				missing.push(mime);
				continue;
			}
			expect(pickViewer(ofCategory(mime, category))?.id ?? null).toBe(
				EXPECTED[mime],
			);
		}
		if (missing.length > 0)
			throw new Error(
				`后端白名单新增了 ${missing.length} 个格式，前端未表态：\n${missing
					.map((m) => `  ${m}`)
					.join(
						"\n",
					)}\n请在本测试的 EXPECTED 里写上看用哪个查看器，或写 null 表示只给下载`,
			);
		expect(missing).toEqual([]);
	});

	it("EXPECTED 里没有早已从后端白名单删掉的死条目", () => {
		const alive = new Set(backendAllowedMimes().map((m) => m.mime));
		const stale = Object.keys(EXPECTED).filter((m) => !alive.has(m));
		expect(stale).toEqual([]);
	});
});
