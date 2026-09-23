// ── /file：上传入口的页面级冒烟 ──
// 两个入口（工具栏按钮、空态 CTA）点的是同一个隐藏 input —— 那次事故把它们一起
// 弄哑了，所以两个都要盯着。
import { expect, test } from "@playwright/test";
import { emptyFilePage, fileItem, mockApi } from "../fixtures/api.ts";

/** 上传成功后的响应（UploadResult = FileItem + duplicate） */
const uploaded = {
	path: "/api/file/upload",
	body: { ...fileItem(2, "smoke.txt"), duplicate: false },
	status: 201,
};

test("「上传文件」按钮真的能打开文件选择框，并且文件提交得出去", async ({
	page,
}) => {
	await mockApi(page, [...emptyFilePage, uploaded]);
	await page.goto("/file");

	// 这一对断言正是那次事故的自动挡：ListPage 迁移把隐藏的 <input type="file">
	// 删掉之后，按钮变成 `getElementById(...)?.click()` 的静默空转 ——
	// 没有 filechooser 事件，这里会一直等到超时。
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser", { timeout: 5_000 }),
		page.getByRole("button", { name: "上传文件", exact: true }).click(),
	]);

	// 选中的文件真的要 POST 到 /api/file/upload（整条链路：按钮 → 选择框 → 上传）
	const uploadRequest = page.waitForRequest(
		(r) => r.method() === "POST" && r.url().includes("/api/file/upload"),
		{ timeout: 5_000 },
	);
	await chooser.setFiles({
		name: "smoke.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("hello e2e"),
	});
	await uploadRequest;

	// 上传面板把这一条列出来（面板在任务清空前一直开着）。
	// 限定在面板内：上传成功后列表里也会出现同名文件，全局找会撞上两个（strict mode）。
	const panel = page.getByTestId("upload-panel");
	await expect(panel).toBeVisible();
	await expect(panel.getByText("smoke.txt")).toBeVisible();
});

test("空态 CTA 也能打开选择框（同一个 input 的第二个入口）", async ({
	page,
}) => {
	await mockApi(page, emptyFilePage);
	await page.goto("/file");

	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser", { timeout: 5_000 }),
		page.getByRole("button", { name: "选择文件上传" }).click(),
	]);
	// 选完就撤：这条只关心"入口通不通"
	await chooser.setFiles({
		name: "cta.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("hi"),
	});
});
