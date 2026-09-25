// ── ErrorRetry 契约测试（此前零覆盖，却是所有详情页错误态的出口）──
// 钉住两件事：错误文案走 getErrorMessage（不是 "undefined"/"[object Object]"），
// 以及重试按钮真的把 onRetry 接上（它是错误态唯一的出路）。

import { HttpError, NetworkError } from "@shared/api";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorRetry from "./ErrorRetry.tsx";

function mount(ui: () => JSX.Element) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(ui, host);
	return host;
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("ErrorRetry", () => {
	it("默认标题是「加载失败」并接上可读的错误消息", () => {
		const host = mount(() => (
			<ErrorRetry
				error={
					new HttpError({ status: 500, code: "BOOM", message: "服务器崩了" })
				}
				onRetry={() => {}}
			/>
		));
		expect(host.textContent).toContain("加载失败");
		expect(host.textContent).toContain("服务器崩了");
	});

	it("message 可覆盖标题（详情页有自己的语境）", () => {
		const host = mount(() => (
			<ErrorRetry
				error={new NetworkError({ cause: "x" })}
				onRetry={() => {}}
				message="卡片加载失败"
			/>
		));
		expect(host.textContent).toContain("卡片加载失败");
		expect(host.textContent).toContain("网络连接失败");
	});

	it("未知错误也给可读文案，不出现 undefined / [object Object]", () => {
		const host = mount(() => (
			<ErrorRetry error={{ weird: true }} onRetry={() => {}} />
		));
		expect(host.textContent).toContain("未知错误");
		expect(host.textContent).not.toContain("undefined");
		expect(host.textContent).not.toContain("[object Object]");
	});

	it("点「重试」调用 onRetry（错误态的唯一出路）", () => {
		const onRetry = vi.fn();
		const host = mount(() => (
			<ErrorRetry error={new Error("x")} onRetry={onRetry} />
		));
		const btn = [...host.querySelectorAll("button")].find(
			(b) => b.textContent === "重试",
		) as HTMLButtonElement;
		expect(btn).toBeTruthy();
		btn.click();
		expect(onRetry).toHaveBeenCalledTimes(1);
	});
});
