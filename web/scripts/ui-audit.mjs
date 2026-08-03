#!/usr/bin/env node
/**
 * ui-audit — 全页面 UI 可访问性巡查
 *
 * 遍历所有页面 × 多种视口，自动检查：
 *  1. 关键交互元素（按钮/链接/输入框）是否可见、是否在视口内可达
 *  2. 横向溢出容器（内容被裁切的风险点）
 *  3. 页面 body 是否可滚动（内容超出视口但滚不动 = 问题）
 *
 * 用法:
 *   node scripts/ui-audit.mjs [--login name:pass] [--page /m] [--viewport 375x700] [--json] [--out file]
 *
 * 选项:
 *   --login name:pass   自动登录（默认不登录，只巡公开页面）
 *   --page <path>       只巡查指定页面（默认全部）
 *   --viewport WxH      只测指定视口（默认 1280x800 / 768x1024 / 375x700）
 *   --base <url>        页面服务地址（默认 http://localhost:3001）
 *   --api <url>         后端 API（默认 http://localhost:3000）
 *   --json              输出 JSON
 *   --out <file>        输出到文件
 */

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);

let chromium;
for (const c of ["./vendor/playwright-core", "/tmp/node_modules/playwright-core"]) {
	try {
		({ chromium } = require(c));
		break;
	} catch {
		/* next */
	}
}
if (!chromium) {
	console.error("错误: 找不到 playwright-core（web/scripts/vendor/ 或 /tmp/node_modules）");
	process.exit(1);
}

const CHROME_PATH =
	process.env.CHROME_PATH ||
	"/home/kly/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";

// ── 页面清单（静态路由；带参数的详情页略过） ──
const PAGES = [
	"/",
	"/t",
	"/o",
	"/c",
	"/c/add",
	"/i",
	"/db",
	"/rg",
	"/text",
	"/reading",
	"/m",
	"/m/add",
	"/m/manage",
	"/conv",
];

const DEFAULT_VIEWPORTS = [
	[1280, 800],
	[768, 1024],
	[375, 700],
];

// ── CLI ──
function parseArgs(argv) {
	const a = {
		login: null,
		page: null,
		viewports: DEFAULT_VIEWPORTS,
		base: "http://localhost:3001",
		api: "http://localhost:3000",
		json: false,
		out: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => argv[++i];
		if (arg === "--login") a.login = next();
		else if (arg === "--page") a.page = next();
		else if (arg === "--viewport") {
			const v = next().split("x").map(Number);
			a.viewports = [[v[0] || 1280, v[1] || 800]];
		} else if (arg === "--base") a.base = next();
		else if (arg === "--api") a.api = next();
		else if (arg === "--json") a.json = true;
		else if (arg === "--out") a.out = next();
		else {
			console.error(`未知选项: ${arg}`);
			process.exit(1);
		}
	}
	return a;
}

// ── 页面内审计逻辑（在浏览器上下文执行） ──
const AUDIT_FN = () => {
	const vw = innerWidth;
	const vh = innerHeight;
	const problems = [];
	const notes = [];

	const visible = (el) => {
		const s = getComputedStyle(el);
		const r = el.getBoundingClientRect();
		return (
			s.display !== "none" &&
			s.visibility !== "hidden" &&
			s.opacity !== "0" &&
			r.width > 0 &&
			r.height > 0
		);
	};

	const labelOf = (el) =>
		(
			el.getAttribute("aria-label") ||
			el.textContent ||
			el.placeholder ||
			el.tagName
		)
			.trim()
			.replace(/\s+/g, " ")
			.slice(0, 32);

	// body/document 是否可滚动（纵向）
	const bodyScrollable =
		document.body.scrollHeight > document.body.clientHeight + 2 ||
		document.documentElement.scrollHeight >
			document.documentElement.clientHeight + 2;

	// 是否存在可滚动祖先（纵向）
	const hasVScrollableAncestor = (el) => {
		let anc = el.parentElement;
		while (anc && anc !== document.body) {
			const s = getComputedStyle(anc);
			const ov = s.overflowY;
			if (
				(ov === "auto" || ov === "scroll" || ov === "overlay") &&
				anc.scrollHeight > anc.clientHeight + 2
			)
				return true;
			anc = anc.parentElement;
		}
		return false;
	};

	// 是否存在可滚动祖先（横向）
	const hasHScrollableAncestor = (el) => {
		let anc = el.parentElement;
		while (anc && anc !== document.body) {
			const s = getComputedStyle(anc);
			if (
				(s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowX === "overlay") &&
				anc.scrollWidth > anc.clientWidth + 2
			)
				return true;
			anc = anc.parentElement;
		}
		return false;
	};

	// 1. 交互元素
	const interactives = [
		...document.querySelectorAll("button, a[href], input, select, textarea"),
	].filter(visible);

	for (const el of interactives) {
		const r = el.getBoundingClientRect();
		const label = labelOf(el);
		// 纵向可达：元素在视口内，或在可滚动区域内（body 或滚动容器）
		const vReachable =
			r.top < vh && r.bottom > 0; // 与视口纵向相交
		const vInScroll =
			bodyScrollable || hasVScrollableAncestor(el);
		if (!vReachable && !vInScroll) {
			problems.push({
				type: "纵向不可达",
				label,
				rect: `top=${Math.round(r.top)} bottom=${Math.round(r.bottom)}`,
			});
		}
		// 横向可达：元素在视口内，或存在横向滚动祖先
		const hReachable = r.left < vw && r.right > 0;
		if (!hReachable && !hasHScrollableAncestor(el)) {
			problems.push({
				type: "横向不可达",
				label,
				rect: `left=${Math.round(r.left)} right=${Math.round(r.right)} (视口 ${vw})`,
			});
		}
	}

	function hasHorizontalScroll(el) {
		return hasHScrollableAncestor(el);
	}

	// 2. 横向溢出容器（scrollWidth > clientWidth，标注 overflow-x 供人工判断）
	const overflowers = [];
	for (const el of document.querySelectorAll("body *")) {
		if (el.scrollWidth > el.clientWidth + 16) {
			const s = getComputedStyle(el);
			overflowers.push({
				cls: (el.className || el.tagName).toString().slice(0, 40),
				overflowX: s.overflowX,
				sw: el.scrollWidth,
				cw: el.clientWidth,
			});
			if (overflowers.length >= 8) break;
		}
	}

	// 3. body 可滚动性（已在上方计算 bodyScrollable）

	return {
		vw,
		vh,
		interactives: interactives.length,
		problems,
		overflowers,
		bodyScrollable,
	};
};

// ── 主流程 ──
(async () => {
	const args = parseArgs(process.argv.slice(2));
	const pages = args.page ? [args.page] : PAGES;

	const browser = await chromium.launch({
		executablePath: CHROME_PATH,
		headless: true,
	});

	// 登录一次拿 token
	let token = null;
	if (args.login) {
		const [name, pass] = args.login.split(":");
		const res = await fetch(`${args.api}/api/user/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, password: pass }),
		});
		const data = await res.json();
		if (res.ok && data.token) token = data.token;
		else console.error(`⚠️ 登录失败: ${JSON.stringify(data).slice(0, 120)}`);
	}

	const report = { pages: {} };

	for (const pagePath of pages) {
		const url = `${args.base}${pagePath}`;
		const pageResults = [];
		for (const [w, h] of args.viewports) {
			const page = await browser.newPage({ viewport: { width: w, height: h } });
			let audit = null;
			try {
				await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
				if (token) {
					await page.evaluate((t) => {
						localStorage.setItem(
							"brainbow_user",
							JSON.stringify({ id: 2, name: "diag", role: "user", token: t }),
						);
					}, token);
					await page.reload({ waitUntil: "networkidle", timeout: 30000 });
				}
				await page.waitForTimeout(2500);
				audit = await page.evaluate(AUDIT_FN);
			} catch (e) {
				audit = { error: String(e).slice(0, 100) };
			}
			pageResults.push({ viewport: `${w}x${h}`, ...audit });
			await page.close();
		}
		report.pages[pagePath] = pageResults;
	}

	await browser.close();

	// ── 输出 ──
	const human = () => {
		const L = [];
		L.push("═══ UI 巡查报告 ═══");
		L.push(`视口: ${args.viewports.map(([w, h]) => `${w}x${h}`).join(" / ")}`);
		L.push(`登录: ${args.login ? args.login.split(":")[0] : "无"}`);
		L.push("");

		let totalProblems = 0;
		for (const [path, results] of Object.entries(report.pages)) {
			L.push(`[${path}]`);
			for (const r of results) {
				const vp = r.viewport;
				if (r.error) {
					L.push(`  ✗ ${vp}: 页面错误 ${r.error}`);
					totalProblems++;
					continue;
				}
				const issues = r.problems || [];
				if (issues.length === 0) {
					L.push(`  ✓ ${vp}: ${r.interactives} 个交互元素可达`);
				} else {
					totalProblems += issues.length;
					L.push(`  ✗ ${vp}: ${issues.length} 个问题`);
					for (const p of issues)
						L.push(`      · ${p.type}: ${p.label} ${p.rect}`);
				}
				for (const o of r.overflowers || []) {
					if (o.overflowX === "visible" || o.overflowX === "hidden") {
						L.push(`      ⚠️ 横向溢出: <${o.cls}> ${o.sw}px > ${o.cw}px (overflow-x: ${o.overflowX})`);
					}
				}
			}
			L.push("");
		}
		L.push(`═══ 汇总: ${totalProblems} 个问题 ═══`);
		return L.join("\n");
	};

	const text = args.json ? JSON.stringify(report, null, 2) : human();
	if (args.out) writeFileSync(args.out, text);
	else console.log(text);
})();
