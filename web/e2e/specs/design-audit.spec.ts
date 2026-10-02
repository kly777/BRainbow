// ── 设计审阅材料：三视口整页截图（不做断言，不是门禁）──
//
// 按 1440 / 768 / 390 三档视口把页面清单逐页整页截图，落到 `e2e/.audit/<标签>/`，
// 供瑞士风格重做的"33 页清单"逐页勾选与前后对比。默认跳过（避免每次 `just e2e`
// 白拍几十张图），生成材料用：
//
//   AUDIT=1 pnpm exec playwright test design-audit                    # → .audit/current/
//   AUDIT=1 AUDIT_LABEL=00-baseline pnpm exec playwright test design-audit
//
// 建议 `--workers=4`：66 张图并发跑满会把 Vite 的按需编译压成超时（实测 8 并发时
// tablet 档出现假红，降到 4 即稳）。
//
// 接口一律造桩为 404：页面会落到统一的错误/空态。这不是缺点 —— 版式、字阶、
// 网格、外壳、空态与错误态本身就是审阅对象，而且这样零依赖（不碰真后端）、
// 可复现（同一份材料可以前后 diff）。
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";
import { mockApi } from "../fixtures/api.ts";

const ENABLED = process.env.AUDIT === "1";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 标签用于先把"改造前"基线拍下来（00-baseline），阶段推进时再拍 current 对比 */
const OUT = path.join(
	HERE,
	"..",
	".audit",
	process.env.AUDIT_LABEL ?? "current",
);

const VIEWPORTS = [
	{ name: "desktop", width: 1440, height: 900 },
	{ name: "tablet", width: 768, height: 1024 },
	{ name: "phone", width: 390, height: 844 },
] as const;

/** 审阅清单：label 同时是文件名（带 :id 的详情页需要真实数据，不在此列） */
const PAGES: { label: string; path: string }[] = [
	{ label: "home", path: "/" },
	{ label: "task", path: "/task" },
	{ label: "card", path: "/card" },
	{ label: "ontology", path: "/ontology" },
	{ label: "file", path: "/file" },
	{ label: "memory", path: "/memory" },
	{ label: "memory-manage", path: "/memory/manage" },
	{ label: "conversation", path: "/conversation" },
	{ label: "chat", path: "/chat" },
	{ label: "chat-prompts", path: "/chat/prompts" },
	{ label: "chat-mem", path: "/chat/mem" },
	{ label: "reading", path: "/reading" },
	{ label: "reading-unknown", path: "/reading/unknown" },
	{ label: "bookmark", path: "/bookmark" },
	{ label: "bookmark-manage", path: "/bookmark/manage" },
	{ label: "db", path: "/db" },
	{ label: "text", path: "/text" },
	{ label: "rainbow", path: "/rainbow" },
	{ label: "search", path: "/search" },
	{ label: "key", path: "/key" },
	{ label: "color", path: "/color" },
	{ label: "admin", path: "/admin" },
];

for (const vp of VIEWPORTS) {
	test.describe(`audit @ ${vp.name}`, () => {
		test.use({ viewport: { width: vp.width, height: vp.height } });
		test.skip(!ENABLED, "审阅材料默认跳过：AUDIT=1 时生成");

		for (const p of PAGES) {
			test(p.label, async ({ page }) => {
				await mockApi(page, []);
				await page.goto(p.path);
				// 等主区渲染 + 一小段稳定时间（字体、骨架屏切换）
				await page.locator("main").waitFor();
				await page.waitForTimeout(400);
				const file = path.join(OUT, vp.name, `${p.label}.png`);
				mkdirSync(path.dirname(file), { recursive: true });
				await page.screenshot({ path: file, fullPage: true });
			});
		}
	});
}
