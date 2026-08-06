import { afterEach, beforeEach, expect, it } from "vitest";
import { render } from "solid-js/web";
import { showConfirm, confirms, dismissAllConfirms } from "./confirmStore";
import ConfirmModalContainer from "./ConfirmModal";

beforeEach(() => {
	dismissAllConfirms();
	document.body.innerHTML = "";
});

afterEach(() => {
	dismissAllConfirms();
	document.body.innerHTML = "";
});

it("点击确认后对话框从列表移除", async () => {
	render(() => <ConfirmModalContainer />, document.body);

	let resolved: boolean | undefined;
	showConfirm({ title: "删除", message: "确定？", variant: "danger" }).then(
		(v) => (resolved = v),
	);
	await Promise.resolve();

	expect(confirms().length).toBe(1);

	const buttons = document.body.querySelectorAll("button");
	expect(buttons.length).toBe(2);
	// 确认按钮是最后一个
	(buttons[buttons.length - 1] as HTMLButtonElement).click();

	await Promise.resolve();
	expect(resolved).toBe(true);
	expect(confirms().length).toBe(0);
});

it("点击取消后对话框从列表移除", async () => {
	render(() => <ConfirmModalContainer />, document.body);

	let resolved: boolean | undefined;
	showConfirm({ title: "删除", message: "确定？", variant: "danger" }).then(
		(v) => (resolved = v),
	);
	await Promise.resolve();

	expect(confirms().length).toBe(1);

	const buttons = document.body.querySelectorAll("button");
	(buttons[0] as HTMLButtonElement).click();

	await Promise.resolve();
	expect(resolved).toBe(false);
	expect(confirms().length).toBe(0);
});
