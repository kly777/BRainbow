// ── 记忆的标签映射：可见页批量填充 + 详情补充 + 增删 ──
//
// 从 useMemManage 里切出来的一块（原文件 355 行）：标签 map 的两条填充 effect
// 与详情标签的增删是同一件事——"某条记忆当前有哪些标签"的本地视图。

import { tryAsync, tryOrNotify } from "@shared/utils";
import { createEffect, createSignal } from "solid-js";
import type { MemItem, TagInfo } from "../../api.ts";
import {
	addTagToMemE,
	batchGetMemsTagsE,
	getMemTagsE,
	removeTagFromMemE,
} from "../../api.ts";

export function useMemTags(deps: {
	/** 当前页条目（列表填充用） */
	mems: () => MemItem[];
	/** 详情打开的条目 id（URL ?id=），未打开为 null */
	detailId: () => number | null;
}) {
	const [memTags, setMemTags] = createSignal<Map<number, TagInfo[]>>(new Map());

	// ── 列表标签批量填充：一次请求拿当前页所有条目的标签 ──
	createEffect(() => {
		const items = deps.mems();
		if (items.length === 0) {
			setMemTags(new Map());
			return;
		}
		void (async () => {
			const result = await tryAsync(() =>
				batchGetMemsTagsE(items.map((m) => m.id)),
			);
			if (!result.ok) return;
			const map = new Map<number, TagInfo[]>();
			for (const row of result.value.items) {
				const tags = map.get(row.mem_id) ?? [];
				tags.push({ id: row.id, name: row.name, created_at: row.created_at });
				map.set(row.mem_id, tags);
			}
			setMemTags(map);
		})();
	});

	// ── 详情标签补充：批量接口只覆盖当前页，详情可能是页外的条目 ──
	createEffect(() => {
		const id = deps.detailId();
		if (id === null) return;
		void (async () => {
			const result = await tryAsync(() => getMemTagsE(id));
			if (!result.ok) return;
			setMemTags((prev) => {
				const next = new Map(prev);
				next.set(id, result.value);
				return next;
			});
		})();
	});

	const tagsForDetail = () => {
		const id = deps.detailId();
		return id !== null ? (memTags().get(id) ?? []) : [];
	};

	const addTag = async (tag: TagInfo) => {
		const id = deps.detailId();
		if (id === null) return;
		const ok = await tryOrNotify(() => addTagToMemE(id, tag.id), "添加标签");
		if (!ok) return;
		setMemTags((prev) => {
			const n = new Map(prev);
			n.set(id, [...(n.get(id) ?? []), tag]);
			return n;
		});
	};

	const removeTag = async (tagId: number) => {
		const id = deps.detailId();
		if (id === null) return;
		const ok = await tryOrNotify(
			() => removeTagFromMemE(id, tagId),
			"移除标签",
		);
		if (!ok) return;
		setMemTags((prev) => {
			const n = new Map(prev);
			n.set(
				id,
				(n.get(id) ?? []).filter((t) => t.id !== tagId),
			);
			return n;
		});
	};

	return { memTags, tagsForDetail, addTag, removeTag };
}

export type MemTags = ReturnType<typeof useMemTags>;
