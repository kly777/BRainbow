// ── /file/:id 详情页数据逻辑：加载/编辑（名称+标签+元信息）/删除 ──

import { PATHS } from "@config/paths";
import { getErrorMessage, HttpError } from "@shared/api";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import { useNavigate, useParams } from "@solidjs/router";
import { createResource, createSignal } from "solid-js";
import type { FileItem } from "../api.ts";
import { deleteFile, getFile, updateFile } from "../api.ts";

export interface MetaEntry {
	key: string;
	value: string;
}

export interface FileDetailApi {
	storedId: () => string;
	data: () => FileItem | undefined;
	dataLoading: boolean;
	dataError: Error | undefined;
	refetch: () => void;
	editing: () => boolean;
	name: () => string;
	setName: (value: string) => void;
	tags: () => string[];
	addTag: (name: string) => void;
	removeTag: (name: string) => void;
	metaEntries: () => MetaEntry[];
	addMetaEntry: () => void;
	removeMetaEntry: (index: number) => void;
	setMetaKey: (index: number, value: string) => void;
	setMetaValue: (index: number, value: string) => void;
	saving: () => boolean;
	formError: () => string;
	startEdit: () => void;
	cancelEdit: () => void;
	save: () => Promise<void>;
	remove: () => Promise<void>;
	handleBack: () => void;
}

export function useFileDetail(): FileDetailApi {
	const params = useParams();
	const navigate = useNavigate();
	const storedId = () => String(params.id ?? "");

	const [data, { refetch }] = createResource(storedId, (id) => {
		if (!id) throw new Error("无效的文件 ID");
		return getFile(id);
	});

	const [editing, setEditing] = createSignal(false);
	const [name, setName] = createSignal("");
	const [tags, setTags] = createSignal<string[]>([]);
	const [metaEntries, setMetaEntries] = createSignal<MetaEntry[]>([]);
	const [saving, setSaving] = createSignal(false);
	const [formError, setFormError] = createSignal("");

	const startEdit = () => {
		const f = data();
		if (!f) return;
		setName(f.original_name);
		setTags([...f.tags]);
		setMetaEntries(
			Object.entries(f.meta ?? {}).map(([key, value]) => ({ key, value })),
		);
		setFormError("");
		setEditing(true);
	};

	const save = async () => {
		const cleanName = name().trim();
		if (!cleanName) {
			setFormError("文件名不能为空");
			return;
		}
		// meta：过滤空 key 行，重复 key 后者覆盖
		const meta: Record<string, string> = {};
		for (const { key, value } of metaEntries()) {
			const k = key.trim();
			if (k) meta[k] = value;
		}
		setSaving(true);
		setFormError("");
		const result = await tryAsync(() =>
			updateFile(storedId(), {
				original_name: cleanName,
				tags: tags(),
				meta,
			}),
		);
		setSaving(false);
		if (result.ok) {
			notifySuccess("文件信息已更新");
			setEditing(false);
			refetch();
		} else {
			setFormError(getErrorMessage(result.error));
		}
	};

	const remove = async () => {
		let force = false;
		for (;;) {
			const confirmed = await showConfirm({
				title: force ? "强制删除文件" : "删除文件",
				message: force
					? "该文件仍被内容引用，强制删除后引用处将无法显示。仍要删除吗？"
					: `确定删除「${data()?.original_name ?? storedId()}」？此操作不可撤销。`,
				variant: "danger",
			});
			if (!confirmed) return;
			const result = await tryAsync(() => deleteFile(storedId(), force));
			if (result.ok) {
				notifySuccess("文件已删除");
				navigate(PATHS.file);
				return;
			}
			if (result.error instanceof HttpError && result.error.status === 409) {
				force = true;
				continue;
			}
			notifyError("删除文件失败", getErrorMessage(result.error));
			return;
		}
	};

	const handleBack = () => {
		navigate(PATHS.file);
	};

	return {
		storedId,
		data,
		get dataLoading() {
			return data.loading;
		},
		get dataError() {
			return data.error;
		},
		refetch,
		editing,
		name,
		setName,
		tags,
		addTag: (n) => setTags((prev) => (prev.includes(n) ? prev : [...prev, n])),
		removeTag: (n) => setTags((prev) => prev.filter((t) => t !== n)),
		metaEntries,
		addMetaEntry: () =>
			setMetaEntries((prev) => [...prev, { key: "", value: "" }]),
		removeMetaEntry: (index) =>
			setMetaEntries((prev) => prev.filter((_, i) => i !== index)),
		setMetaKey: (index, value) =>
			setMetaEntries((prev) =>
				prev.map((e, i) => (i === index ? { ...e, key: value } : e)),
			),
		setMetaValue: (index, value) =>
			setMetaEntries((prev) =>
				prev.map((e, i) => (i === index ? { ...e, value } : e)),
			),
		saving,
		formError,
		startEdit,
		cancelEdit: () => setEditing(false),
		save,
		remove,
		handleBack,
	};
}
