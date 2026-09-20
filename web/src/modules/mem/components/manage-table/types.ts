import type { MemItem, TagInfo } from "@modules/mem";

export type SortField = "cue.created_at" | "difficulty" | "due_at" | "state";
export type SortDir = "asc" | "desc";

export interface PageMeta {
	page: number;
	total_pages: number;
	total: number;
}

/**
 * 行级操作：收成一个对象。
 *
 * 这三个回调原先被复制进 4 个接口（Props / TableBodyProps / MemRowProps /
 * MemTableProps）逐层转发 —— 加一个操作要改四处签名。收成一束后组件之间的
 * 传递只剩"这份数据 + 这束操作"。
 */
export interface RowActions {
	onToggleBatch: (id: number) => void;
	onSelectRow: (id: number) => void;
	onDelete: (id: number) => void;
}

/** 单元格里预览用的短文本 */
export function previewText(content: string): string {
	return content.slice(0, 50).replace(/\n/g, " ") || "（空）";
}

/** 一行渲染所需的全部输入 */
export interface RowInput {
	mem: MemItem;
	selected: boolean;
	active: boolean;
	tags: readonly TagInfo[];
	actions: RowActions;
}
