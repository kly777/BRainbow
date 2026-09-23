// ── /reading：文章列表的页面级冒烟 ──
//
// 这条是"列表页通检"的样板：接口给 N 条 → 页面上 N 条的标题都在。
// 它不依赖 testid（用标题文本），所以给任意列表页补一条都很便宜；
// 而"只剩最后一页""渲染被裁掉一半"这类事故都能被它抓住。
import { expect, test } from "@playwright/test";
import { article, mockApi } from "../fixtures/api.ts";

test("接口返回的文章都渲染出来了", async ({ page }) => {
	const titles = ["第一篇示例文章", "第二篇示例文章", "第三篇示例文章"];
	await mockApi(page, [
		{
			path: "/api/reading",
			body: { articles: titles.map((t, i) => article(i + 1, t)) },
		},
	]);

	await page.goto("/reading");

	for (const title of titles) {
		await expect(page.getByText(title)).toBeVisible();
	}
});
