#!/usr/bin/env node
/**
 * ui-inspect — 页面样式与布局诊断工具
 *
 * 用于调整样式前获取页面的精确信息：
 *  - computed style（字体/颜色/间距/尺寸/定位）
 *  - 布局诊断（溢出、换行、子元素尺寸、对齐）
 *  - 设计 token（CSS 变量）
 *
 * 用法:
 *   node scripts/ui-inspect.mjs <url> [选项]
 *
 * 选项:
 *   --viewport WxH        视口尺寸，默认 1280x800
 *   --selector <s>        目标元素（CSS 选择器；纯文本自动匹配 CSS-module class）
 *   --token               输出 CSS 变量表
 *   --layout              布局诊断（溢出/换行/子元素）
 *   --login name:pass     自动登录（调后端 /api/user/login）
 *   --token-file <path>   从文件读取 JWT（或 --login 自动获取）
 *   --base <url>          页面服务地址（默认 http://localhost:3001）
 *   --api <url>           后端 API 地址（默认 http://localhost:3000）
 *   --out <file>          输出到文件（.json 或 .md）
 *   --json                纯 JSON 输出
 *
 * 示例:
 *   node scripts/ui-inspect.mjs /m --viewport 375x700 --selector actionRow --layout --login name:password
 *   node scripts/ui-inspect.mjs /m/manage --selector "tableCard" --layout --token
 */

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);

// ── 解析 playwright-core（项目 vendor → /tmp → 全局） ──
let chromium;
const candidates = [
	"./vendor/playwright-core",
	"/tmp/node_modules/playwright-core",
];
for (const c of candidates) {
	try {
		({ chromium } = require(c));
		break;
	} catch {
		/* try next */
	}
}
if (!chromium) {
	console.error("错误: 找不到 playwright-core（web/scripts/vendor/ 或 /tmp/node_modules）");
	process.exit(1);
}

const CHROME_PATH =
	process.env.CHROME_PATH ||
	"/home/kly/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";

// ── CLI 解析 ──
function parseArgs(argv) {
	const args = { url: "/", viewport: [1280, 800], selector: null, token: false, layout: false, login: null, base: "http://localhost:3001", api: "http://localhost:3000", out: null, json: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => argv[++i];
		if (a === "--viewport") {
			const v = next().split("x").map(Number);
			args.viewport = [v[0] || 1280, v[1] || 800];
		} else if (a === "--selector") args.selector = next();
		else if (a === "--token") args.token = true;
		else if (a === "--layout") args.layout = true;
		else if (a === "--login") args.login = next();
		else if (a === "--base") args.base = next();
		else if (a === "--api") args.api = next();
		else if (a === "--out") args.out = next();
		else if (a === "--json") args.json = true;
		else if (a.startsWith("-")) {
			console.error(`未知选项: ${a}`);
			process.exit(1);
		} else args.url = a;
	}
	return args;
}

// ── 选择器归一化：纯文本 → CSS-module class 匹配 ──
function normalizeSelector(sel) {
	if (!sel) return null;
	if (/^[.#\[>~+]|^[a-zA-Z][\w-]*$/.test(sel) && !sel.includes(" ")) {
		// 纯词（如 actionRow）→ 匹配 hash class
		if (!sel.startsWith(".") && !sel.startsWith("#") && !sel.startsWith("["))
			return `[class*="${sel}"]`;
	}
	return sel;
}

// ── 登录：拿 JWT ──
async function login(api, namePass) {
	const [name, pass] = namePass.split(":");
	const res = await fetch(`${api}/api/user/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, password: pass }),
	});
	const data = await res.json();
	if (!res.ok || !data.token) {
		console.error(`登录失败: ${JSON.stringify(data).slice(0, 200)}`);
		process.exit(1);
	}
	return data;
}

// ── 收集页面信息 ──
async function collect(page, args) {
	return await page.evaluate(
		({ selector, wantToken, wantLayout }) => {
			const pick = (el) => {
				const cs = getComputedStyle(el);
				const r = el.getBoundingClientRect();
				const out = {
					className: el.className || el.tagName,
					rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
					computed: {},
					overflow: {
						scrollWidth: el.scrollWidth,
						clientWidth: el.clientWidth,
						scrollHeight: el.scrollHeight,
						clientHeight: el.clientHeight,
					},
				};
				const keys = [
					"display", "position", "width", "height", "min-width", "max-width",
					"padding", "margin", "gap", "border", "border-radius",
					"background", "background-color", "color", "opacity",
					"font-family", "font-size", "font-weight", "line-height",
					"flex-direction", "flex-wrap", "align-items", "justify-content",
					"z-index", "box-shadow", "overflow-x", "overflow-y",
					"transform", "letter-spacing", "text-transform",
				];
				for (const k of keys) out.computed[k] = cs[k];
				// 子元素布局
				out.children = [...el.children].map((k) => {
					const kr = k.getBoundingClientRect();
					return {
						text: (k.textContent || "").trim().slice(0, 12),
						tag: k.tagName.toLowerCase(),
						top: Math.round(kr.top),
						width: Math.round(kr.width),
						height: Math.round(kr.height),
					};
				});
				// 换行检测：子元素 top 分组数
				if (out.children.length > 1) {
					out.rows = new Set(out.children.map((c) => c.top)).size;
				}
				return out;
			};

			const result = {
				url: location.href,
				viewport: { w: innerWidth, h: innerHeight },
			};

			if (wantToken) {
				const vars = {};
				for (const el of [document.documentElement, ...document.querySelectorAll("*")]) {
					const cs = getComputedStyle(el);
					for (const k of cs) {
						if (k.startsWith("--") && !(k in vars)) vars[k] = cs.getPropertyValue(k).trim();
					}
				}
				result.cssVars = Object.fromEntries(
					Object.entries(vars).sort(([a], [b]) => a.localeCompare(b)),
				);
			}

			if (selector) {
				const el = document.querySelector(selector);
				result.element = el ? pick(el) : null;
				result.matchedCount = document.querySelectorAll(selector).length;
			}

			if (wantLayout) {
				// 常用容器布局快照
				result.body = pick(document.body);
				result.layout = {
					bodyScrollable: document.body.scrollHeight > document.body.clientHeight,
					body: pick(document.body),
				};
			}
			return result;
		},
		{
			selector: args.selector ? normalizeSelector(args.selector) : null,
			wantToken: args.token,
			wantLayout: args.layout,
		},
	);
}

// ── 人读输出 ──
function humanize(info, args) {
	const L = [];
	L.push(`URL: ${info.url}`);
	L.push(`视口: ${info.viewport.w}x${info.viewport.h}\n`);

	if (info.cssVars) {
		L.push("══ CSS 变量 ══");
		for (const [k, v] of Object.entries(info.cssVars))
			L.push(`  ${k}: ${v}`);
		L.push("");
	}

	if (info.matchedCount !== undefined) {
		L.push(`══ 元素: ${args.selector} (匹配 ${info.matchedCount} 个) ══`);
		if (!info.element) {
			L.push("  (未找到)");
		} else {
			const el = info.element;
			L.push("  计算样式:");
			for (const [k, v] of Object.entries(el.computed))
				L.push(`    ${k}: ${v}`);
			L.push(`  布局: left=${el.rect.left} top=${el.rect.top} w=${el.rect.width} h=${el.rect.height}`);
			const ov = el.overflow;
			const hOverflow = ov.scrollWidth > ov.clientWidth;
			const vOverflow = ov.scrollHeight > ov.clientHeight;
			L.push(`  溢出: scrollW=${ov.scrollWidth} clientW=${ov.clientWidth} ${hOverflow ? "⚠️ 横向溢出" : "✓ 无横向溢出"} | scrollH=${ov.scrollHeight} clientH=${ov.clientHeight} ${vOverflow ? "⚠️ 纵向溢出" : "✓ 无纵向溢出"}`);
			if (el.children?.length) {
				L.push(`  子元素 (${el.children.length} 个, ${el.rows ?? 1} 行):`);
				for (const c of el.children)
					L.push(`    ${c.text || c.tag.padEnd(8)}  top=${c.top} w=${c.width} h=${c.height}`);
			}
		}
		L.push("");
	}

	if (info.layout) {
		L.push(`══ 布局诊断 ══`);
		const b = info.layout.body;
		L.push(`  body: w=${b.rect.width} h=${b.rect.height} scrollH=${b.overflow.scrollHeight} ${info.layout.bodyScrollable ? "⚠️ 页面可滚动" : "页面固定"}`);
		L.push("");
	}
	return L.join("\n");
}

// ── 主流程 ──
(async () => {
	const args = parseArgs(process.argv.slice(2));
	const url = args.url.startsWith("http") ? args.url : `${args.base}${args.url}`;

	const browser = await chromium.launch({
		executablePath: CHROME_PATH,
		headless: true,
	});
	const page = await browser.newPage({
		viewport: { width: args.viewport[0], height: args.viewport[1] },
	});

	// 登录（先到页面域，注入 localStorage 后 reload）
	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
	if (args.login) {
		const user = await login(args.api, args.login);
		await page.evaluate((u) => {
			localStorage.setItem(
				"brainbow_user",
				JSON.stringify({ id: u.id, name: u.name, role: u.role, token: u.token }),
			);
		}, user);
		await page.reload({ waitUntil: "networkidle", timeout: 30000 });
	}
	await page.waitForTimeout(2500);

	const info = await collect(page, args);
	await browser.close();

	if (args.json || args.out?.endsWith(".json")) {
		const text = JSON.stringify(info, null, 2);
		if (args.out) writeFileSync(args.out, text);
		else console.log(text);
	} else {
		const text = humanize(info, args);
		if (args.out) writeFileSync(args.out, text);
		else console.log(text);
	}
})();
