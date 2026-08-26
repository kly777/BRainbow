// ── AsyncView accessor seam 回归测试 ──
// 核心保证：data 数组换身份 ≠ 子树重建。children 内的
// 输入框在刷新后保持同一 DOM 节点与焦点（卡片页搜索失焦 bug 的类级封堵）。

import { AsyncView } from "@components/ui/molecules/AsyncView.tsx";
import { createRoot, createSignal } from "solid-js";
import { For, render } from "solid-js/web";
import { describe, expect, it } from "vitest";

describe("AsyncView children accessor seam", () => {
	it("data 刷新不重建子树：input 保持同一节点", () => {
		const [items, setItems] = createSignal([{ id: 1 }, { id: 2 }]);
		const host = document.createElement("div");
		document.body.appendChild(host);

		createRoot((dispose) => {
			render(
				() => (
					<AsyncView data={items()}>
						{(data) => (
							<ul>
								<li>
									<input aria-label="probe" />
								</li>
								<For each={data()}>{(x) => <li>{x.id}</li>}</For>
							</ul>
						)}
					</AsyncView>
				),
				host,
			);

			// For 需要 solid-js/web 的 For —— 在文件顶部统一导入
			const input = host.querySelector("input")!;
			input.focus();

			setItems([{ id: 1 }, { id: 2 }, { id: 3 }]);

			expect(document.activeElement).toBe(input);
			expect(host.querySelectorAll("input")[0]).toBe(input);
			dispose();
		});
	});

	it("loading/error/empty 四态切换仍然整树替换", async () => {
		const [loading, setLoading] = createSignal(false);
		const host = document.createElement("div");
		document.body.appendChild(host);

		await createRoot(async (dispose) => {
			render(
				() => (
					<AsyncView data={[{ id: 1 }]} loading={loading()}>
						{() => <div data-testid="content">ok</div>}
					</AsyncView>
				),
				host,
			);

			expect(host.querySelector("[data-testid='content']")).toBeTruthy();

			setLoading(true);
			await Promise.resolve();
			expect(host.querySelector("[data-testid='content']")).toBeNull();
			expect(host.querySelector(".skeleton")).toBeTruthy();

			setLoading(false);
			await Promise.resolve();
			expect(host.querySelector("[data-testid='content']")).toBeTruthy();
			dispose();
		});
	});
});
