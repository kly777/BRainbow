// ── 非图片文件的"类型底色"（纯函数、有测试） ──
//
// 网格里非图片文件此前一律是同一块灰底 + 后缀徽章，几十个铺开像一堵墙，
// 找东西只能逐个读文字。这里按类型给出一个**稳定**色相（同一个后缀永远同色），
// 渲染时交给 CSS 用 color-mix 混进当前主题的表面色 —— 深浅随主题自动走，
// 不必为 paper / midnight / ocean 各配一套色板。
//
// 只回答"该偏哪个方向"，不产出具体颜色：具体颜色归 tokens 管。

import type { FileItem } from "../api.ts";
import { fileExt } from "./filename.ts";

/** 后缀 → 色相锚点（同族相近、跨族分开；单位是度） */
const EXT_HUES: Record<string, number> = {
	// 文档（靛蓝）
	pdf: 262,
	doc: 262,
	docx: 262,
	odt: 262,
	rtf: 262,
	pages: 262,
	txt: 262,
	// 表格（绿）
	xls: 148,
	xlsx: 148,
	ods: 148,
	csv: 148,
	tsv: 148,
	numbers: 148,
	// 演示（橙）
	ppt: 42,
	pptx: 42,
	odp: 42,
	key: 42,
	// 压缩归档（橙红）
	zip: 22,
	rar: 22,
	"7z": 22,
	tar: 22,
	gz: 22,
	xz: 22,
	bz2: 22,
	zst: 22,
	// 代码与配置（青蓝）
	rs: 205,
	ts: 205,
	tsx: 205,
	js: 205,
	json: 205,
	py: 205,
	go: 205,
	java: 205,
	c: 205,
	h: 205,
	cpp: 205,
	sh: 205,
	sql: 205,
	yaml: 205,
	yml: 205,
	toml: 205,
	// 电子书（品红）
	epub: 320,
	mobi: 320,
	azw3: 320,
	fb2: 320,
	// 数据库（青绿）
	sqlite: 178,
	sqlite3: 178,
	db: 178,
	duckdb: 178,
	// 3D / 点云（天蓝）
	ply: 195,
	splat: 195,
	stl: 195,
	obj: 195,
	gltf: 195,
	glb: 195,
	// 音频（紫）
	mp3: 300,
	wav: 300,
	flac: 300,
	m4a: 300,
	aac: 300,
	ogg: 300,
	opus: 300,
	// 视频（玫红）
	mp4: 355,
	mkv: 355,
	mov: 355,
	webm: 355,
	avi: 355,
	m4v: 355,
	// 字体（棕）
	ttf: 60,
	otf: 60,
	woff: 60,
	woff2: 60,
};

/** 无后缀时的兜底：按类别偏色（类别少，五个方向够用） */
const CATEGORY_HUES: Record<FileItem["file_category"], number> = {
	// 图片有真内容可看，本来就不着色（见 shouldTint）；留个值只为补全类型
	image: 0,
	video: 355,
	audio: 300,
	document: 262,
	other: 210,
};

/** 未收录后缀：FNV-1a 取模，散得开且可复现（别用随机/时间，否则每次刷新都变色） */
function hashHue(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return Math.abs(h) % 360;
}

/** 这一格该偏哪个色相（0–359 的整数） */
export function tintHue(
	item: Pick<FileItem, "original_name" | "file_category">,
): number {
	const ext = fileExt(item.original_name);
	if (ext) return EXT_HUES[ext.toLowerCase()] ?? hashHue(ext);
	return CATEGORY_HUES[item.file_category] ?? 210;
}

/**
 * 是否给这一格上类型底色。
 * 图片不上：它有真缩略图/真徽章，着色反而像烂图。缺失文件不上：
 * 彩色底会让人觉得"这里还有东西"，与缺失的事实相反。
 */
export function shouldTint(
	item: Pick<FileItem, "file_category" | "missing">,
): boolean {
	return item.file_category !== "image" && !item.missing;
}
