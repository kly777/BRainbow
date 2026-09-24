// ── 接口桩与夹具 ──
//
// 页面 e2e 不碰真后端：所有 /api/** 都在浏览器层被 route 接管。这样用例是确定的
// （不依赖库里的数据、不依赖后端有没有在跑），也不会往 dev 库写东西。
import type { Page } from "@playwright/test";

interface Stub {
	/** 精确的 pathname（如 `/api/cards`）或正则 */
	path: string | RegExp;
	body: unknown;
	status?: number;
	/** 默认 application/json；文件内容之类的响应要显式给 */
	contentType?: string;
}

/**
 * 装接口桩：**只放行用例显式配桩的接口，其余 /api/** 一律 404**。
 *
 * 故意不"静默放行到真后端"：页面悄悄多调了一个接口时，应该得到一条红色的用例
 * 与一条明确的 `e2e 未配桩：/api/xxx`，而不是一个碰巧通过的测试。
 *
 * 匹配用**谓词**而不是 `"**\/api\/**"` 这种 glob：后者会连模块路径一起拦
 * （`/src/shared/api/index.ts` 也含 `/api/`），页面直接起不来 —— 踩过一次。
 */
export async function mockApi(page: Page, stubs: Stub[]) {
	await page.route(
		(url) => url.pathname.startsWith("/api/"),
		async (route) => {
			const { pathname } = new URL(route.request().url());
			const hit = stubs.find((s) =>
				typeof s.path === "string"
					? pathname === s.path
					: s.path.test(pathname),
			);
			if (!hit) {
				await route.fulfill({
					status: 404,
					contentType: "application/json",
					body: JSON.stringify({
						code: "NOT_FOUND",
						message: `e2e 未配桩：${pathname}`,
					}),
				});
				return;
			}
			// 非 JSON 的响应（文件内容 / 文本片段）直接把 body 当字符串发出去
			const json = (hit.contentType ?? "application/json").includes("json");
			await route.fulfill({
				status: hit.status ?? 200,
				contentType: hit.contentType ?? "application/json",
				body: json ? JSON.stringify(hit.body) : String(hit.body),
			});
		},
	);
}

/** 一页数据（后端统一分页响应，见 shared/pagination） */
export function page1<T>(items: T[], total: number, totalPages = 1) {
	return {
		items,
		page: 1,
		page_size: items.length,
		total,
		total_pages: totalPages,
	};
}

export const card = (id: number) => ({
	id,
	content: `卡片 ${id}`,
	created_at: "2026-05-01T00:00:00+00:00",
	updated_at: "2026-05-01T00:00:00+00:00",
});

export const fileItem = (id: number, name: string, stored = `stored${id}`) => ({
	id,
	stored_id: stored,
	url: `/api/file/${stored}/data/${encodeURIComponent(name)}`,
	original_name: name,
	mime_type: "text/plain",
	file_category: "document",
	size_bytes: 11,
	width: null,
	height: null,
	duration_ms: null,
	tags: [],
	created_at: "2026-05-01T00:00:00+00:00",
	updated_at: "2026-05-01T00:00:00+00:00",
	missing: false,
	is_private: false,
	can_edit: true,
});

/** /file 页打开就要用的那三条接口（列表为空 —— 空态还会给出 CTA 入口） */
export const emptyFilePage: Stub[] = [
	{ path: "/api/file", body: page1([], 0) },
	{
		path: "/api/file/stats",
		body: { total_count: 0, total_bytes: 0, by_category: [] },
	},
	{ path: "/api/file/tags", body: [] },
];

export const article = (id: number, title: string) => ({
	id,
	title,
	word_count: 120,
	known_ratio: 0.9,
	unknown_word_count: 3,
	created_at: "2026-05-01T00:00:00+00:00",
});
