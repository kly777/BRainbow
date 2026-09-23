// ── /card：瀑布流列表的页面级冒烟 ──
import { expect, test } from "@playwright/test";
import { card, mockApi } from "../fixtures/api.ts";

// 线上那次事故：加载更多顺手改了数据源的分页键，资源按新页号重取一次，
// 刚累积的列表被整份换成"最后一页"—— 只断言"有卡片"是抓不住的，必须断言总数。

test("两页都累积在列表里（不是只剩最后一页）", async ({ page }) => {
	// 第 1 页刻意小：它一定填不满一屏，页面的"填满才继续加载"才会去取第 2 页 ——
	// 不这么设计的话，用例是否走到第 2 页就取决于视口与卡片高度，测起来很脆。
	const first = Array.from({ length: 3 }, (_, i) => card(100 + i));
	const second = Array.from({ length: 2 }, (_, i) => card(200 + i));

	await mockApi(page, [
		{
			path: "/api/cards",
			body: { items: first, page: 1, page_size: 20, total: 5, total_pages: 2 },
		},
	]);
	// 后注册的路由优先：第 2 页单独回 2 条（同样按 pathname + 查询串判定）
	await page.route(
		(url) =>
			url.pathname === "/api/cards" && url.searchParams.get("page") === "2",
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					items: second,
					page: 2,
					page_size: 20,
					total: 5,
					total_pages: 2,
				}),
			}),
	);

	await page.goto("/card");

	// 旧代码在这一行红：列表会被第 2 页整份替换，只剩 2 张
	await expect(page.getByTestId("card")).toHaveCount(5);
});

test("卡片多到一屏放不下时，瀑布流能横向滚动", async ({ page }) => {
	// 单独一页、够多卡片：断言的是版式（列超出可视宽度 → 可横滑），
	// 不掺和分页，避免两件事互相干扰
	const many = Array.from({ length: 30 }, (_, i) => card(300 + i));
	await mockApi(page, [
		{
			path: "/api/cards",
			body: { items: many, page: 1, page_size: 30, total: 30, total_pages: 1 },
		},
	]);

	await page.goto("/card");
	await expect(page.getByTestId("card")).toHaveCount(30);

	const grid = page.getByTestId("card-masonry");
	expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
		true,
	);
});
