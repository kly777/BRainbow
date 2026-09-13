// ── BatchBar / UploadPanel 渲染测试 ──
// 二者原先内联在 930 行的 FileList.tsx 里，已抽到 components/。这组断言锁住
// 抽取后的对外契约：计数文案、按选中数显隐、批量加标签的空值守卫、上传结果的
// 状态文案与进度换算。

import type { ComponentProps } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import BatchBar from "./BatchBar.tsx";
import UploadPanel from "./UploadPanel.tsx";

type BarProps = ComponentProps<typeof BatchBar>;
type PanelProps = ComponentProps<typeof UploadPanel>;

const noop = async () => {};

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as never, host);
	return host;
}

describe("BatchBar", () => {
	const props = (over: Partial<BarProps> = {}): BarProps => ({
		count: 2,
		total: 5,
		onSelectAll: vi.fn(),
		onClear: vi.fn(),
		onAddTag: vi.fn(noop),
		onCopyLinks: vi.fn(noop),
		onDelete: vi.fn(noop),
		...over,
	});

	it("显示已选数量", () => {
		const host = mount(() => <BatchBar {...props()} />);
		expect(host.textContent).toContain("已选 2 / 5");
	});

	it("未选中任何条目时整条不渲染", () => {
		const host = mount(() => <BatchBar {...props({ count: 0 })} />);
		expect(host.textContent?.trim()).toBe("");
	});

	it("已全选时禁用「全选本页」", () => {
		const host = mount(() => <BatchBar {...props({ count: 5, total: 5 })} />);
		const btn = Array.from(host.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("全选本页"),
		) as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
	});

	it("点击「取消选择」回调", () => {
		const onClear = vi.fn();
		const host = mount(() => <BatchBar {...props({ onClear })} />);
		const btn = Array.from(host.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("取消选择"),
		);
		btn?.click();
		expect(onClear).toHaveBeenCalledTimes(1);
	});

	it("批量加标签：空输入不发请求", async () => {
		const onAddTag = vi.fn(noop);
		const host = mount(() => <BatchBar {...props({ onAddTag })} />);
		// 输入框初始为空，直接提交
		const submit = Array.from(host.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("加标签"),
		);
		submit?.click();
		await Promise.resolve();
		expect(onAddTag).not.toHaveBeenCalled();
	});
});

describe("UploadPanel", () => {
	type Task = ReturnType<PanelProps["tasks"]>[number];
	const task = (over: Partial<Task> = {}): Task =>
		({
			id: 1,
			name: "大文件.mp4",
			size: 200,
			loaded: 100,
			status: "uploading",
			...over,
		}) as Task;

	it("按任务数渲染文件名与进度百分比", () => {
		const host = mount(() => (
			<UploadPanel tasks={() => [task()]} onClose={() => {}} />
		));
		expect(host.textContent).toContain("大文件.mp4");
		expect(host.textContent).toContain("50%");
	});

	it("完成 / 重复 / 失败各自给出对应文案", () => {
		const host = mount(() => (
			<UploadPanel
				tasks={() =>
					[
						task({ id: 1, name: "甲", status: "done" }),
						task({ id: 2, name: "乙", status: "duplicate" }),
						task({ id: 3, name: "丙", status: "error" }),
					] as never
				}
				onClose={() => {}}
			/>
		));
		expect(host.textContent).toContain("完成");
		expect(host.textContent).toContain("已存在");
		expect(host.textContent).toContain("失败");
	});

	it("size 为 0 时进度不出现除零（记为 0%）", () => {
		const host = mount(() => (
			<UploadPanel
				tasks={() => [task({ size: 0, loaded: 0 })]}
				onClose={() => {}}
			/>
		));
		expect(host.textContent).toContain("0%");
	});

	it("关闭按钮回调", () => {
		const onClose = vi.fn();
		const host = mount(() => (
			<UploadPanel tasks={() => [task()]} onClose={onClose} />
		));
		// 面板头部有标题与关闭按钮
		const buttons = host.querySelectorAll("button");
		buttons[buttons.length - 1]?.click();
		expect(onClose).toHaveBeenCalled();
	});
});
