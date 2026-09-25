// ── 书签表单状态 + CRUD ──
// 从 useBookmarkPage 拆分：创建/编辑弹窗、表单验证、保存。

import { notifySuccess, tryAsync } from "@shared/utils";
import { createStore } from "solid-js/store";
import type { Bookmark } from "../api.ts";
import {
	checkBookmarkUrlE,
	createBookmarkE,
	fetchUrlTitleE,
	setBookmarkTagsE,
	updateBookmarkE,
} from "../api.ts";

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
		// URL 查重状态
		urlChecking: false,
		urlExists: false,
		urlExistsBookmark: null as Bookmark | null,
		// 获取标题状态
		fetchingTitle: false,
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
			urlChecking: false,
			urlExists: false,
			urlExistsBookmark: null,
			fetchingTitle: false,
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
			urlChecking: false,
			urlExists: false,
			urlExistsBookmark: null,
			fetchingTitle: false,
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

	/** 检查 URL 是否已被收藏 */
	async function checkUrl(url: string) {
		const clean = url.trim();
		if (!clean || !/^https?:\/\//i.test(clean)) {
			setForm("urlExists", false);
			setForm("urlExistsBookmark", null);
			return;
		}
		// 编辑模式下，如果 URL 没变，不检查
		if (form.editing && form.editing.url === clean) {
			setForm("urlExists", false);
			setForm("urlExistsBookmark", null);
			return;
		}
		setForm("urlChecking", true);
		const result = await tryAsync(() => checkBookmarkUrlE(clean));
		if (result.ok) {
			setForm("urlExists", result.value.exists);
			setForm("urlExistsBookmark", result.value.bookmark);
		}
		setForm("urlChecking", false);
	}

	/** 通过 URL 抓取网页标题 */
	async function fetchTitle(url: string) {
		const clean = url.trim();
		if (!clean || !/^https?:\/\//i.test(clean)) return;
		setForm("fetchingTitle", true);
		const result = await tryAsync(() => fetchUrlTitleE(clean));
		if (result.ok && result.value.title) {
			setForm("title", result.value.title);
		}
		setForm("fetchingTitle", false);
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
		// 创建模式下检查重复
		if (!form.editing && form.urlExists) {
			setForm("error", "该 URL 已被收藏，不能重复添加");
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
		checkUrl,
		fetchTitle,
	};
}
