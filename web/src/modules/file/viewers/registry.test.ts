// ── 查看器注册表契约 ──
//
// 两条规则：
//  1. **表驱动命中**：给定一条文件记录，必须命中预期的查看器 id（undefined = 走下载兜底）。
//     顺序即优先级，所以泛化规则（text/*）排在具体规则之后这件事也被钉住。
//  2. **已知类型覆盖**：后端 kind.rs 的 KINDS 表里每个 mime 在前端都要有明确归属——要么有
//     查看器，要么显式记在 EXPECTED 里标成 null（"这个类型就是只下载"）。为了让这份镜像
//     不靠人工同步，第 2 条直接解析 kind.rs：后端加格式 → 这条测试失败 → 逼一次
//     "要不要做查看器"的决定，而不是等用户上传完看到一块空白预览区。
//     （第二步计划：把已知类型从接口发出去，这里的源码解析就可以退役。）

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FileCategory, FileItem } from "../api.ts";
import { pickViewer } from "./registry.ts";
import { item as file } from "./test-fixtures.ts";

// vitest 从 web/ 启动（同 shared/styles/css-modules-contract.test.ts 的路径假设）。
// 类型 → 能力（含上限档）的表在后端 `kind.rs`（原在 limits.rs 的 ALLOWED_MIMES）
const KIND_RS = join(process.cwd(), "../src/modules/file/kind.rs");

/** 按类别造一条记录（类别的口径在后端 `FileCategory::from_mime`） */
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
			"M4A 音频：ISO BMFF 族内按 ftyp brand 定出 audio/mp4（族相同、种不同）",
			ofCategory("audio/mp4", "audio", "a.m4a"),
			"audio",
		],
		[
			"MOV：与 MP4 同族，按 brand 定出 video/quicktime",
			ofCategory("video/quicktime", "video", "a.mov"),
			"video",
		],
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
			"老 .doc 没有解析器，仍然只给下载（下一条是它的新格式兄弟）",
			ofCategory("application/msword", "document", "a.doc"),
			undefined,
		],
		[
			"压缩包：列条目清单（内容判据在后端，前端按扩展名认领）",
			ofCategory("application/zip", "other", "a.zip"),
			"archive",
		],
		[
			"epub 电子书（本身也是 zip，内容判据在后端）",
			ofCategory("application/epub+zip", "other", "一本书.epub"),
			"epub",
		],
		[
			"3D 模型（glb/stl/obj）走 three.js 查看器，与泼溅查看器是两条管线",
			ofCategory("application/octet-stream", "other", "模型.glb"),
			"model",
		],
		[
			"stl / gltf 同样走模型查看器",
			ofCategory("application/octet-stream", "other", "part.stl"),
			"model",
		],
		[
			"SQLite 数据库按扩展名认领（内容判据在后端）",
			ofCategory("application/octet-stream", "other", "notes.sqlite"),
			"database",
		],
		[
			"tar.gz 这种双扩展名一起认",
			ofCategory("application/gzip", "other", "备份.tar.gz"),
			"archive",
		],
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
			".splat（参考实现的定长格式，与 .ply 同一个查看器，按内容分辨）",
			ofCategory("application/octet-stream", "other", "模型.splat"),
			"splat",
		],
		[
			"点云 .pcd / .xyz / .pts 也走泼溅查看器（引擎按内容分流到普通点云路径）",
			ofCategory("application/octet-stream", "other", "scan.pcd"),
			"splat",
		],
		[
			"通用点云 .xyz 同理",
			ofCategory("application/octet-stream", "other", "cloud.xyz"),
			"splat",
		],
		[
			".las 暂不认领（LAS 的十种点位格式另需解析器，落到 hex 回答「这是什么」）",
			ofCategory("application/octet-stream", "other", "scan.las"),
			"hex",
		],
		[
			"改名成 .bin 的泼溅文件不再被认领（只按扩展名判，内容判据在查看器内部）",
			ofCategory("application/octet-stream", "other", "模型.bin"),
			"hex",
		],
		// ── 顺序即优先级：按扩展名认领的规则必须排在泛化的文本规则之前 ──
		// 下面这三条的 mime 都是后端如实判出的 text/*（内容确实是文本），
		// 若让 code/text 先命中，点云与网格会被渲染成一屏纯文本
		[
			"ASCII 的 .ply 内容被判成 text/plain，但仍要进泼溅查看器",
			ofCategory("text/plain", "document", "scan.ply"),
			"splat",
		],
		[
			"ASCII 的 .stl 同理（text/plain 但进模型查看器）",
			ofCategory("text/plain", "document", "part.stl"),
			"model",
		],
		[
			".gltf 是 JSON 文本，同样要被模型查看器认领",
			ofCategory("text/plain", "document", "scene.gltf"),
			"model",
		],
		[
			"SQLite 的类别是 document（application/vnd.* 前缀规则），照样进数据库查看器",
			ofCategory("application/vnd.sqlite3", "document", "notes.sqlite"),
			"database",
		],
		[
			"JSON：以前是 application/json → other → 十六进制预览，现在按文本判",
			ofCategory("text/plain", "document", "config.json"),
			"code",
		],
		[
			"二进制内容却声明成文本 → 后端归 octet-stream，落到 hex",
			ofCategory("application/octet-stream", "other", "fake.txt"),
			"hex",
		],
		[
			"docx（正文由后端解析成 HTML 预览）",
			ofCategory(
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				"document",
				"报告.docx",
			),
			"docx",
		],
		[
			"pptx（后端按放映顺序抽出每页标题/正文/备注）",
			ofCategory(
				"application/vnd.openxmlformats-officedocument.presentationml.presentation",
				"document",
				"汇报.pptx",
			),
			"pptx",
		],
		[
			"xlsx（后端 calamine 解析成表格数据）",
			ofCategory(
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				"document",
				"数据.xlsx",
			),
			"xlsx",
		],
		[
			"字幕：后端按字节判出文本 → mime 就是 text/plain（前端那张 PLAIN_TEXT_EXTS 清单已退休）",
			ofCategory("text/plain", "document", "英语听力.srt"),
			"text",
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

describe("查看器注册表：后端已知类型覆盖", () => {
	/** 解析 kind.rs 的 KINDS 表，得到后端认的全部（精确行的）mime */
	function backendKnownMimes(): string[] {
		const src = readFileSync(KIND_RS, "utf8");
		const start = src.indexOf("const KINDS");
		if (start < 0)
			throw new Error(
				`在 ${KIND_RS} 里找不到 KINDS——表结构变了？请同步更新本测试`,
			);
		const end = src.indexOf("];", start);
		const block = src.slice(start, end);
		return [...block.matchAll(/kind\(\s*"([^"]+)"\s*,/g)]
			.map((m) => m[1])
			.filter((mime) => !mime.endsWith("*"));
	}

	/**
	 * 类别的口径与后端 `FileCategory::from_mime` 一致（前缀规则 + 一个例外）：
	 * 这个测试关心的是"每个已知类型有没有查看器归属"，类别只是构造记录的输入。
	 */
	function backendCategoryOf(mime: string): string {
		if (mime.startsWith("image/")) return "image";
		if (mime.startsWith("video/")) return "video";
		if (mime.startsWith("audio/")) return "audio";
		if (mime === "application/epub+zip") return "other";
		return "document";
	}

	/**
	 * 构造记录时给一个**真实存在**的扩展名：查看器的规则里有些按扩展名认领
	 * （epub 就是 —— 它的 MIME 归"其他"类别，前端靠 `.epub` 认领），
	 * 夹具名不对会被误判成"没有归属"。
	 */
	function sampleName(mime: string): string {
		if (mime === "application/epub+zip") return "a.epub";
		return `a.${mime.split("/")[1]}`;
	}

	/**
	 * 后端每个已知 mime 在前端的归属：查看器 id，或 null = 明确只给下载。
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
		// Office：docx / xlsx / xls 由后端解析后预览（见 preview.rs）；
		// .doc（老 Word）是二进制 OLE，另需一套解析器，暂时只给下载
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
			"docx",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
		"application/vnd.ms-excel": "xlsx",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation":
			"pptx",
		"application/msword": null,
		// epub 不在文件服务的类别规则里（归"其他"），但服务端按书解析它
		"application/epub+zip": "epub",
	};

	it("kind.rs 的 KINDS 能解析出来（解析失败要吵，不能静默放过）", () => {
		expect(backendKnownMimes().length).toBeGreaterThanOrEqual(20);
	});

	it("每个已知 mime 都有明确归属（查看器或显式 null）", () => {
		const missing: string[] = [];
		for (const mime of backendKnownMimes()) {
			if (!(mime in EXPECTED)) {
				missing.push(mime);
				continue;
			}
			expect(
				pickViewer(ofCategory(mime, backendCategoryOf(mime), sampleName(mime)))
					?.id ?? null,
			).toBe(EXPECTED[mime]);
		}
		if (missing.length > 0)
			throw new Error(
				`后端新增了 ${missing.length} 个格式，前端未表态：\n${missing
					.map((m) => `  ${m}`)
					.join(
						"\n",
					)}\n请在本测试的 EXPECTED 里写上看用哪个查看器，或写 null 表示只给下载`,
			);
		expect(missing).toEqual([]);
	});

	it("EXPECTED 里没有早已从后端表删掉的死条目", () => {
		const alive = new Set(backendKnownMimes());
		const stale = Object.keys(EXPECTED).filter((m) => !alive.has(m));
		expect(stale).toEqual([]);
	});
});
