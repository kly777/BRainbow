/**
 * ui-check.mjs — headless UI 检查工具（封装常用操作）
 *
 * 用法:
 *   node scripts/ui-check.mjs layout                     # /m 显示答案布局（重叠检测）
 *   node scripts/ui-check.mjs manage                     # /m/manage 表格渲染
 *   node scripts/ui-check.mjs add                        # /m/add 添加页渲染
 *   node scripts/ui-check.mjs card                       # /c 卡片列表渲染
 *   node scripts/ui-check.mjs pages                      # 全页面基本渲染（ui-audit 的精简版）
 *   node scripts/ui-check.mjs inspect <路径> <选择器>     # 通用：元素位置+computed style
 *   node scripts/ui-check.mjs all                        # 跑全部主要检查
 *
 * 环境变量: UI_BASE(默认 http://localhost:3001) API_BASE(默认 http://localhost:3000)
 *          UI_USER/UI_PASS(默认 diag/diag1234) UI_VIEWPORT(默认 1280x800)
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("./vendor/playwright-core/index.js");

const BASE = process.env.UI_BASE ?? "http://localhost:3001";
const API = process.env.API_BASE ?? "http://localhost:3000";
const USER = process.env.UI_USER ?? "diag";
const PASS = process.env.UI_PASS ?? "diag1234";
const [W, H] = (process.env.UI_VIEWPORT ?? "1280x800").split("x").map(Number);
const CHROME = process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;

// ── 常用操作 ──────────────────────────────────────────────

/** 登录拿 token */
export async function login() {
	const res = await fetch(`${API}/api/user/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name: USER, password: PASS }),
	});
	const data = await res.json();
	if (!data.token) throw new Error(`登录失败: ${JSON.stringify(data)}`);
	return data.token;
}

/** 打开页面 + 注入 token + 等渲染 */
export async function openApp(page, path = "/m", token) {
	await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
	await page.evaluate(
		(t) => localStorage.setItem("brainbow_user", JSON.stringify({ id: 2, name: "diag", role: "user", token: t })),
		token,
	);
	await page.reload({ waitUntil: "networkidle" });
	await page.waitForTimeout(4500);
}

/** 点包含指定文本的按钮 */
export async function clickText(page, text) {
	await page.evaluate(
		(t) => [...document.querySelectorAll("button")].find((b) => b.textContent.includes(t))?.click(),
		text,
	);
	await page.waitForTimeout(700);
}

/** 元素位置（四值矩形） */
export async function rect(page, selector) {
	return page.evaluate((s) => {
		const el = document.querySelector(s);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
	}, selector);
}

/** 元素 computed style（取指定属性） */
export async function styleOf(page, selector, props) {
	return page.evaluate(
		([s, ps]) => {
			const el = document.querySelector(s);
			if (!el) return null;
			const cs = getComputedStyle(el);
			return Object.fromEntries(ps.map((p) => [p, cs[p]]));
		},
		[selector, props],
	);
}

/** 页面文本 */
export async function bodyText(page) {
	return page.evaluate(() => document.body.innerText.slice(0, 60));
}

// ── 检查项 ────────────────────────────────────────────────

/** /m 显示答案后布局：face/answer 不重叠 */
export async function checkLayout(browser) {
	const p = await browser.newPage({ viewport: { width: W, height: H } });
	const token = await login();
	await openApp(p, "/m", token);
	await clickText(p, "显示答案");

	const face = await rect(p, "[class*=face]");
	const answer = await rect(p, "[class*=answer_]");
	const ctx = await styleOf(p, "[class*=ContextBar_]", ["backgroundColor", "borderBottomColor"]);

	const pass = face && answer && face.bottom <= answer.top;
	return {
		name: "layout",
		pass,
		detail: {
			face: face && [face.top, face.bottom],
			answer: answer && [answer.top, answer.bottom],
			overlap: face && answer ? face.bottom - answer.top : "n/a",
			contextBarBg: ctx?.backgroundColor,
		},
	};
}

/** /m/manage 表格渲染 */
export async function checkManage(browser) {
	const p = await browser.newPage({ viewport: { width: W, height: H } });
	const token = await login();
	await openApp(p, "/m/manage", token);
	const rows = await p.evaluate(() => document.querySelectorAll("[class*=row]").length);
	const hasTable = await p.evaluate(() => !!document.querySelector("[class*=table_]"));
	return { name: "manage", pass: rows > 0 && hasTable, detail: { rows, hasTable } };
}

/** /m/add 渲染 */
export async function checkAdd(browser) {
	const p = await browser.newPage({ viewport: { width: W, height: H } });
	const token = await login();
	await openApp(p, "/m/add", token);
	const r = await p.evaluate(() => ({
		modeTabs: !!document.querySelector("[class*=modeTabs]"),
		textarea: !!document.querySelector("[class*=textarea]"),
	}));
	return { name: "add", pass: r.modeTabs && r.textarea, detail: r };
}

/** /c 卡片列表渲染 */
export async function checkCard(browser) {
	const p = await browser.newPage({ viewport: { width: W, height: H } });
	const token = await login();
	await openApp(p, "/c", token);
	const card = await styleOf(p, "[class*=Card_card__]", ["backgroundColor", "borderRadius"]);
	const count = await p.evaluate(() => document.querySelectorAll("[class*=Card_card__]").length);
	return {
		name: "card",
		pass: card?.backgroundColor === "oklch(0.99 0.004 95)" && count > 0,
		detail: { count, bg: card?.backgroundColor, radius: card?.borderRadius },
	};
}

/** 通用：任意元素位置 + 样式检查 */
export async function checkInspect(browser, path, selector) {
	const p = await browser.newPage({ viewport: { width: W, height: H } });
	const token = await login();
	await openApp(p, path, token);
	const r = await rect(p, selector);
	const s = await styleOf(p, selector, [
		"backgroundColor", "color", "borderColor", "borderRadius", "fontFamily", "fontSize",
	]);
	const text = await bodyText(p);
	await p.close();
	return {
		name: "inspect",
		pass: !!r,
		detail: { rect: r, style: s, body: text },
	};
}

// ── 入口 ──────────────────────────────────────────────────

const checks = {
	layout: checkLayout,
	manage: checkManage,
	add: checkAdd,
	card: checkCard,
	inspect: checkInspect,
};

export async function main() {
	const [cmd, path, selector] = process.argv.slice(2);

	if (cmd === "all") {
		const browser = await chromium.launch({ executablePath: CHROME, headless: true });
		const results = [];
		for (const key of ["layout", "manage", "add", "card"]) {
			try {
				results.push(await checks[key](browser));
			} catch (e) {
				results.push({ name: key, pass: false, detail: String(e).slice(0, 80) });
			}
		}
		await browser.close();
		for (const r of results) console.log(`${r.pass ? "✅" : "❌"} ${r.name}: ${JSON.stringify(r.detail)}`);
		console.log(`═══ 汇总: ${results.filter((r) => r.pass).length}/${results.length} 通过 ═══`);
		return;
	}

	if (cmd === "inspect" && path && selector) {
		const browser = await chromium.launch({ executablePath: CHROME, headless: true });
		const r = await checks.inspect(browser, path, selector);
		await browser.close();
		console.log(JSON.stringify(r, null, 1));
		return;
	}

	if (checks[cmd]) {
		const browser = await chromium.launch({ executablePath: CHROME, headless: true });
		const r = await checks[cmd](browser);
		await browser.close();
		console.log(JSON.stringify(r, null, 1));
		return;
	}

	console.log(`用法: node scripts/ui-check.mjs [layout|manage|add|card|pages|inspect <路径> <选择器>|all]`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
	console.error("❌", e.message);
	process.exit(1);
});
