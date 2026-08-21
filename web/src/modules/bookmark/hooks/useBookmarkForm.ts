// ── 书签表单状态 + CRUD ──
// 从 useBookmarkPage 拆分：创建/编辑弹窗、表单验证、保存。

import { notifySuccess, tryAsync } from "@lib/utils";
import type { Bookmark } from "@modules/bookmark";
import {
	createBookmarkE,
	setBookmarkTagsE,
	updateBookmarkE,
} from "@modules/bookmark";
import { createStore } from "solid-js/store";

export interface UseBookmarkFormOpts {
	/** 保存成功后的回调（刷新列表） */
	onSaved: () => void;
}

export function useBookmarkForm(opts: UseBookmarkFormOpts) {
	// 表单状态聚合为 createStore（符合 S3 规范）
	const [form, setForm] = createStore({
		open: false,
		editing: null as Bookmark | null,
		title: "",
		url: "",
		desc: "",
		tags: [] as string[],
		saving: false,
		error: null as string | null,
	});

	function openCreate() {
		setForm({
			open: true,
			editing: null,
			title: "",
			url: "",
			desc: "",
			tags: [],
			error: null,
		});
	}

	function openEdit(bm: Bookmark) {
		setForm({
			open: true,
			editing: bm,
			title: bm.title,
			url: bm.url,
			desc: bm.description,
			tags: [...bm.tags],
			error: null,
		});
	}

	function addTag(name: string) {
		if (!name.trim()) return;
		if (!form.tags.includes(name.trim())) {
			setForm("tags", (prev) => [...prev, name.trim()]);
		}
	}

	function removeTag(name: string) {
		setForm("tags", (prev) => prev.filter((t) => t !== name));
	}

	function close() {
		setForm("open", false);
	}

	async function handleSave() {
		const title = form.title.trim();
		const url = form.url.trim();
		if (!title) {
			setForm("error", "标题不能为空");
			return;
		}
		if (!/^https?:\/\//i.test(url)) {
			setForm("error", "URL 必须以 http:// 或 https:// 开头");
			return;
		}

		setForm("saving", true);
		setForm("error", null);
		const tags = form.tags;
		const body = { title, url, description: form.desc.trim() };
		const result = await tryAsync(async () => {
			if (form.editing) {
				const updated = await updateBookmarkE(form.editing.id, body);
				await setBookmarkTagsE(updated.id, tags);
				return { ...updated, tags };
			}
			return createBookmarkE({ ...body, tags });
		});
		if (result.ok) {
			setForm("open", false);
			notifySuccess(form.editing ? "书签已更新" : "书签已添加");
			opts.onSaved();
		} else {
			setForm("error", result.error.message);
		}
		setForm("saving", false);
	}

	return {
		form,
		setForm,
		openCreate,
		openEdit,
		addTag,
		removeTag,
		close,
		handleSave,
	};
}
