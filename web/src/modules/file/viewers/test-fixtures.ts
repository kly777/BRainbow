// ── 查看器测试的公共夹具（FileItem 字段多，省得每处都写全） ──

import type { FileCategory, FileItem } from "../api.ts";

export const item = (over: Partial<FileItem> = {}): FileItem => ({
	id: 1,
	stored_id: "s1",
	url: "/api/file/s1/data/a.bin",
	original_name: "a.bin",
	mime_type: "application/octet-stream",
	file_category: "other" as FileCategory,
	size_bytes: 1024,
	width: null,
	height: null,
	duration_ms: null,
	tags: [],
	meta: {},
	created_at: "2026-09-14T00:00:00+00:00",
	updated_at: "2026-09-14T00:00:00+00:00",
	missing: false,
	is_private: false,
	can_edit: true,
	...over,
});
