// ── 文件分类的中文展示名（后端枚举是英文，界面统一说人话） ──

import type { FileCategory } from "../api.ts";

const CATEGORY_LABEL: Record<FileCategory, string> = {
	image: "图片",
	video: "视频",
	audio: "音频",
	document: "文档",
	other: "其他",
};

export function categoryLabel(category: FileCategory): string {
	return CATEGORY_LABEL[category];
}
