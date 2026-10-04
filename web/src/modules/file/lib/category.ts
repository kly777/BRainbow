// ── 文件分类的中文展示名（后端枚举是英文，界面统一说人话） ──

import type { FileCategory } from "../api.ts";

const CATEGORY_LABEL: Record<FileCategory, string> = {
	image: "图片",
	video: "视频",
	audio: "音频",
	document: "文档",
	other: "其他",
};

/**
 * 全部真实分类（不含"全部"那个筛选项），顺序即界面上筛选项的顺序。
 *
 * 从 `CATEGORY_LABEL` 的键派生 —— 那张表是 `Record<FileCategory, string>`，
 * 后端加一个分类时它编译不过，这里跟着自动长出来。于是"分类有哪些"
 * 只由 `api.ts` 的 `FileCategory` 一处定义（原先筛选清单抄了三份，
 * 其中 FileList.tsx 那份连中文名都重抄了一遍）。
 */
export const CATEGORIES = Object.keys(
	CATEGORY_LABEL,
) as readonly FileCategory[];

export function categoryLabel(category: FileCategory): string {
	return CATEGORY_LABEL[category];
}
