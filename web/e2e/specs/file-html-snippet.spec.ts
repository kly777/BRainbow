// ── /file：HTML 文件的列表缩略要走元信息，而不是原始标记 ──
//
// 保存下来的网页（SingleFile 之类）开头全是标记与内联样式：按原始文本取前几行只会
// 看到 `<!DOCTYPE html>`、`<meta …>`、`<style>…`，看不到重点。这条盯住"卡片上出现
// 的是标题/来源/描述这类元信息"。
import { expect, test } from "@playwright/test";
import { fileItem, mockApi, page1 } from "../fixtures/api.ts";

/** 照搬真实文件的开头（SingleFile 注释 + meta + 内联样式 + 正文） */
const SAVED_PAGE = `<!DOCTYPE html> <html><!--
 Page saved with SingleFile 
 url: https://floooh.github.io/2018/06/17/handles-vs-pointers.html 
 saved date: Wed Sep 23 2026 21:34:21 GMT+0800 (Hong Kong Standard Time)
--><meta charset=utf-8>
<meta name=description content="Handles are better than pointers for resource management">
<title>Handles are the better pointers</title>
<style>body{margin:0;font-family:sans-serif}</style>
<h1>Handles are the better pointers</h1>
<p>正文第一段。</p>`;

const HTML_FILE = {
	...fileItem(1, "handles.html", "savedpage123"),
	mime_type: "text/html",
	size_bytes: 64990,
};

test("HTML 卡片显示元信息（标题 / 来源 URL / 描述），看不到原始标记", async ({
	page,
}) => {
	await mockApi(page, [
		{ path: "/api/file", body: page1([HTML_FILE], 1) },
		{
			path: "/api/file/stats",
			body: { total_count: 1, total_bytes: 64990, by_category: [] },
		},
		{ path: "/api/file/tags", body: [] },
		{
			// 缩略片段走的 Range 请求（206 + 文本）
			path: "/api/file/savedpage123/data/handles.html",
			body: SAVED_PAGE,
			status: 206,
			contentType: "text/html; charset=utf-8",
		},
	]);

	await page.goto("/file");

	await expect(
		page.getByText(
			"https://floooh.github.io/2018/06/17/handles-vs-pointers.html",
		),
	).toBeVisible();
	await expect(
		page.getByText("Handles are better than pointers for resource management"),
	).toBeVisible();
	// 卡片上不该出现标记本身（那正是"看不到重点"的来源）
	await expect(page.getByText(/<!DOCTYPE html>/)).toHaveCount(0);
	await expect(page.getByText(/<meta charset/)).toHaveCount(0);
});

/** 窗口正好切在 `<style>` 中间的样子（Range 取 4KB，闭合标签落在窗口外） */
const TRUNCATED_PAGE = `<!DOCTYPE html> <html><!--
 Page saved with SingleFile 
 url: https://floooh.github.io/2018/06/17/handles-vs-pointers.html 
--><meta charset=utf-8>
<title>Handles are the better pointers</title>
<meta name=description content="Handles are better than pointers for resource management">
<style>body{margin:0}</style>
<style data-emotion=css data-s>@keyframes animation-xykzx5{100%{background-position:200%center}}@keyframes animation-13a8dyy{0%,100%{opacity:1}50%{opacity:0}}@keyframes animation-1vov3o0{0%{text-shadow:rgb(255,255,255) 0px`;

const TRUNCATED_FILE = {
	...fileItem(2, "truncated.html", "truncated123"),
	mime_type: "text/html",
	size_bytes: 64990,
};

test("窗口切在 <style> 中间时，CSS 不会被当成正文显示", async ({ page }) => {
	await mockApi(page, [
		{ path: "/api/file", body: page1([TRUNCATED_FILE], 1) },
		{
			path: "/api/file/stats",
			body: { total_count: 1, total_bytes: 64990, by_category: [] },
		},
		{ path: "/api/file/tags", body: [] },
		{
			path: "/api/file/truncated123/data/truncated.html",
			body: TRUNCATED_PAGE,
			status: 206,
			contentType: "text/html; charset=utf-8",
		},
	]);

	await page.goto("/file");

	await expect(
		page.getByText("Handles are the better pointers", { exact: true }),
	).toBeVisible();
	// 一长串 Emotion 注入的 `@keyframes …` 曾在卡片上原样显示
	await expect(page.getByText(/@keyframes/)).toHaveCount(0);
});
