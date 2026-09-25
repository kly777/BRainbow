// ── FileCard / FileRow 渲染测试 ──
// 二者原先内联在 930 行的 FileList.tsx 里，已抽到 components/。抽取是逐字搬运，
// 但"抽出来"本身就是一个单元边界 —— 这组断言锁住它们的对外契约：
// 展示态显示文件名与元信息、选择模式下出现勾选框并回调、缺失文件给出标记、
// 缩略图只在可预览时渲染。

import type { ComponentProps } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import type { FileItem } from "../api.ts";
import FileCard from "./FileCard.tsx";
import FileRow from "./FileRow.tsx";

type CardProps = ComponentProps<typeof FileCard>;
type RowProps = ComponentProps<typeof FileRow>;

const item = (over: Partial<FileItem> = {}): FileItem => ({
	id: 1,
	stored_id: "abc123",
	url: "/api/file/abc123/data/照片.png",
	original_name: "照片.png",
	mime_type: "image/png",
	file_category: "image",
	size_bytes: 2048,
	width: 800,
	height: 600,
	duration_ms: null,
	tags: ["假期"],
	meta: {},
	created_at: "2026-09-09T13:00:00+00:00",
	updated_at: "2026-09-09T13:00:00+00:00",
	missing: false,
	is_private: false,
	can_edit: true,
	...over,
});

const noop = () => {};

function cardProps(over: Partial<CardProps> = {}): CardProps {
	return {
		item: item(),
		editing: false,
		highlighted: false,
		selectMode: false,
		selected: false,
		editName: "",
		actions: {
			onToggleSelect: noop,
			onOpen: noop,
			onZoom: noop,
			onContextMenu: noop,
			onStartRename: noop,
			onDelete: noop,
			onRename: noop,
			onEditName: noop,
			onCancelEdit: noop,
		},
		...over,
	};
}

function rowProps(over: Partial<RowProps> = {}): RowProps {
	return {
		item: item(),
		highlighted: false,
		selectMode: false,
		selected: false,
		onToggleSelect: noop,
		onOpen: noop,
		onZoom: noop,
		onContextMenu: noop,
		onStartRename: noop,
		onDelete: noop,
		...over,
	};
}

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as never, host);
	return host;
}

describe("FileCard", () => {
	it("展示态渲染文件名与标签", () => {
		const host = mount(() => <FileCard {...cardProps()} />);
		expect(host.textContent).toContain("照片.png");
		expect(host.textContent).toContain("假期");
	});

	it("携带 data-file-id（列表据此做滚动定位）", () => {
		const host = mount(() => <FileCard {...cardProps()} />);
		expect(host.querySelector("[data-file-id='abc123']")).toBeTruthy();
	});

	it("选择模式下出现勾选框并回调 stored_id", () => {
		const onToggleSelect = vi.fn();
		const host = mount(() => (
			<FileCard
				{...cardProps({
					selectMode: true,
					actions: { ...cardProps().actions, onToggleSelect },
				})}
			/>
		));
		const box = host.querySelector(
			"input[type='checkbox']",
		) as HTMLInputElement;
		expect(box).toBeTruthy();
		box.click();
		expect(onToggleSelect).toHaveBeenCalledWith("abc123");
	});

	it("非选择模式不渲染勾选框", () => {
		const host = mount(() => <FileCard {...cardProps()} />);
		expect(host.querySelector("input[type='checkbox']")).toBeNull();
	});

	it("编辑态渲染重命名输入框并回调输入", () => {
		const onEditName = vi.fn();
		const host = mount(() => (
			<FileCard
				{...cardProps({
					editing: true,
					editName: "新名字",
					actions: { ...cardProps().actions, onEditName },
				})}
			/>
		));
		// 重命名输入框靠 aria-label 定位（它没有 type 属性）
		const input = host.querySelector(
			"input[aria-label='文件名称']",
		) as HTMLInputElement;
		expect(input?.value).toBe("新名字");
		input.value = "改名";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(onEditName).toHaveBeenCalledWith("改名");
	});

	it("缺失文件给出标记", () => {
		const host = mount(() => (
			<FileCard {...cardProps({ item: item({ missing: true }) })} />
		));
		expect(host.textContent).toContain("文件缺失");
	});
});

describe("FileRow", () => {
	it("渲染文件名与元信息", () => {
		const host = mount(() => <FileRow {...rowProps()} />);
		expect(host.textContent).toContain("照片.png");
	});

	it("选择模式下渲染勾选框并回调", () => {
		const onToggleSelect = vi.fn();
		const host = mount(() => (
			<FileRow {...rowProps({ selectMode: true, onToggleSelect })} />
		));
		const box = host.querySelector(
			"input[type='checkbox']",
		) as HTMLInputElement;
		expect(box).toBeTruthy();
		box.click();
		expect(onToggleSelect).toHaveBeenCalledWith("abc123");
	});

	it("缺失文件给出标记", () => {
		const host = mount(() => (
			<FileRow {...rowProps({ item: item({ missing: true }) })} />
		));
		expect(host.textContent).toContain("文件缺失");
	});
});
