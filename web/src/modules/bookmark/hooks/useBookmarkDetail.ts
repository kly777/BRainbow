import { PATHS } from "@config/paths";
import {
	deleteBookmarkE,
	getBookmarkE,
	setBookmarkTagsE,
	suggestBookmarkTagsE,
	updateBookmarkE,
} from "@modules/bookmark";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryOrNotify,
} from "@shared/utils";
import { useNavigate, useParams } from "@solidjs/router";
import { createResource, createSignal } from "solid-js";

export type BookmarkItem = Awaited<ReturnType<typeof getBookmarkE>>;

export interface BookmarkDetailApi {
	id: () => number;
	data: () => BookmarkItem | undefined;
	dataLoading: boolean;
	dataError: Error | undefined;
	refetch: () => void;
	editing: () => boolean;
	title: () => string;
	setTitle: (value: string) => void;
	url: () => string;
	setUrl: (value: string) => void;
	description: () => string;
	setDescription: (value: string) => void;
	tags: () => string[];
	addTag: (name: string) => void;
	removeTag: (name: string) => void;
	saving: () => boolean;
	formError: () => string;
	startEdit: () => void;
	cancelEdit: () => void;
	save: () => Promise<void>;
	remove: () => Promise<void>;
	handleBack: () => void;
	// AI 标签建议
	suggestTags: () => Promise<void>;
	suggestLoading: () => boolean;
	suggestedTags: () => string[];
	acceptSuggestedTag: (tag: string) => void;
}

export function useBookmarkDetail(): BookmarkDetailApi {
	const params = useParams();
	const navigate = useNavigate();
	const id = () => Number(params.id);

	const [data, { refetch }] = createResource(id, (v) => {
		if (!Number.isInteger(v) || v < 1) throw new Error("无效的书签 ID");
		return getBookmarkE(v);
	});

	const [editing, setEditing] = createSignal(false);
	const [title, setTitle] = createSignal("");
	const [url, setUrl] = createSignal("");
	const [description, setDescription] = createSignal("");
	const [tags, setTags] = createSignal<string[]>([]);
	const [saving, setSaving] = createSignal(false);
	const [formError, setFormError] = createSignal("");
	// AI 标签建议
	const [suggestLoading, setSuggestLoading] = createSignal(false);
	const [suggestedTags, setSuggestedTags] = createSignal<string[]>([]);

	const startEdit = () => {
		const bm = data();
		if (!bm) return;
		setTitle(bm.title);
		setUrl(bm.url);
		setDescription(bm.description);
		setTags([...bm.tags]);
		setFormError("");
		setSuggestedTags([]);
		setEditing(true);
	};

	const save = async () => {
		const cleanTitle = title().trim();
		const cleanUrl = url().trim();
		if (!cleanTitle) {
			setFormError("标题不能为空");
			return;
		}
		if (!/^https?:\/\//i.test(cleanUrl)) {
			setFormError("URL 必须以 http:// 或 https:// 开头");
			return;
		}
		setSaving(true);
		setFormError("");
		const ok = await tryOrNotify(async () => {
			const updated = await updateBookmarkE(id(), {
				title: cleanTitle,
				url: cleanUrl,
				description: description().trim(),
			});
			await setBookmarkTagsE(updated.id, tags());
			return updated;
		}, "保存书签");
		setSaving(false);
		if (ok) {
			notifySuccess("书签已更新");
			setEditing(false);
			refetch();
		}
	};

	const remove = async () => {
		const bm = data();
		const confirmed = await showConfirm({
			title: "删除书签",
			message: `确定删除「${bm?.title ?? id()}」？此操作不可撤销。`,
			variant: "danger",
		});
		if (!confirmed) return;
		const ok = await tryOrNotify(() => deleteBookmarkE(id()), "删除书签");
		if (ok) navigate(PATHS.bookmark);
	};

	const handleBack = () => {
		navigate(PATHS.bookmark);
	};

	/** AI 建议标签 */
	const suggestTags = async () => {
		setSuggestLoading(true);
		setSuggestedTags([]);
		const result = await tryOrNotify(
			() => suggestBookmarkTagsE(id()),
			"AI 标签建议",
		);
		if (result) {
			// 过滤掉已有标签
			const existing = new Set(tags());
			const newTags = result.tags.filter((t) => !existing.has(t));
			setSuggestedTags(newTags);
			if (newTags.length === 0) {
				notifySuccess("AI 建议的标签都已存在");
			}
		}
		setSuggestLoading(false);
	};

	const acceptSuggestedTag = (tag: string) => {
		if (!tags().includes(tag)) {
			setTags((prev) => [...prev, tag]);
		}
		setSuggestedTags((prev) => prev.filter((t) => t !== tag));
	};

	return {
		id,
		data,
		dataLoading: data.loading,
		dataError: data.error,
		refetch,
		editing,
		title,
		setTitle,
		url,
		setUrl,
		description,
		setDescription,
		tags,
		addTag: (name) =>
			setTags((prev) => (prev.includes(name) ? prev : [...prev, name])),
		removeTag: (name) => setTags((prev) => prev.filter((t) => t !== name)),
		saving,
		formError,
		startEdit,
		cancelEdit: () => setEditing(false),
		save,
		remove,
		handleBack,
		suggestTags,
		suggestLoading,
		suggestedTags,
		acceptSuggestedTag,
	};
}
