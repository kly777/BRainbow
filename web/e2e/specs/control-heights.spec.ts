// ── 同一行的控件必须等高 ──
//
// 这轮改版修掉的一类通病：工具条里 36px 的输入框挨着 28px 的按钮、行内 22px 的图标键
// 挨着 36px 的下拉 —— 零圆角 + 硬规线的世界里，这类骨架错位特别扎眼，而"看着差不多"
// 是查不出来的。这里用**几何审计**把它变成断言：把页面上所有可见控件按视觉行聚簇，
// 同一行内最高与最低之差不得超过 2px（边框亚像素误差）。
//
// 高度档只有三档，令牌见 global.css：--control-h-sm 28px / --control-h-md 36px /
// --control-h-lg 44px。新增页面要纳入这道门禁时，配好接口桩再追加一条 test 即可。
import { expect, test, type Page } from "@playwright/test";
import { card, emptyFilePage, mockApi, page1 } from "../fixtures/api.ts";

/** 同一行内允许的高度差（px）：只容忍边框/亚像素误差 */
const TOLERANCE = 2;

interface RaggedRow {
	spread: number;
	items: { label: string; tag: string; height: number }[];
}

/** 把可见控件按视觉行聚簇，返回高度不一致的行 */
async function findRaggedRows(page: Page): Promise<RaggedRow[]> {
	return page.evaluate((tolerance) => {
		const label = (el: Element) => {
			const text = (el.textContent ?? "")
				.trim()
				.replace(/\s+/g, " ")
				.slice(0, 14);
			if (text) return text;
			const type = el.getAttribute("type");
			const aria = el.getAttribute("aria-label");
			return `<${el.tagName.toLowerCase()}${type ? `:${type}` : ""}${aria ? ` ${aria}` : ""}>`;
		};

		const controls = [
			...document.querySelectorAll(
				'button, input, select, textarea, [role="button"], [role="combobox"]',
			),
		]
			.map((el) => {
				const r = el.getBoundingClientRect();
				return {
					label: label(el),
					tag: el.tagName.toLowerCase(),
					top: r.top,
					center: r.top + r.height / 2,
					height: Math.round(r.height),
					visible: r.width > 0 && r.height > 0,
				};
			})
			.filter((c) => c.visible);

		const rows: (typeof controls)[] = [];
		for (const c of controls) {
			const row = rows.find((r) =>
				r.some((o) => Math.abs(o.center - c.center) <= 4),
			);
			if (row) row.push(c);
			else rows.push([c]);
		}

		return rows
			.filter((r) => r.length >= 2)
			.map((r) => ({
				spread:
					Math.max(...r.map((x) => x.height)) -
					Math.min(...r.map((x) => x.height)),
				items: r.map((x) => ({ label: x.label, tag: x.tag, height: x.height })),
			}))
			.filter((r) => r.spread > tolerance);
	}, TOLERANCE);
}

async function expectNoRaggedRows(page: Page) {
	const ragged = await findRaggedRows(page);
	expect(
		ragged.map(
			(r) =>
				`${r.spread}px: ${r.items.map((i) => `${i.label}=${i.height}`).join(" | ")}`,
		),
	).toEqual([]);
}

test("/file：工具条与芯片行的控件等高", async ({ page }) => {
	await mockApi(page, [...emptyFilePage]);
	await page.goto("/file");
	await expect(
		page.getByRole("button", { name: "上传文件", exact: true }),
	).toBeVisible();
	await expectNoRaggedRows(page);
});

test("/card：工具条的控件等高", async ({ page }) => {
	await mockApi(page, [{ path: "/api/cards", body: page1([card(1), card(2)], 2) }]);
	await page.goto("/card");
	await expect(page.getByTestId("card-masonry")).toBeVisible();
	await expectNoRaggedRows(page);
});
