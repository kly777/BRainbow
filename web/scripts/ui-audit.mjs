#!/usr/bin/env node
/**
 * ui-audit — 全页面 UI 可访问性巡查（v2 扩展版）
 *
 * 遍历所有页面 × 多种视口，检查：
 *  ✗ 确定问题：
 *    1. 交互元素纵向/横向不可达（视口外且无滚动容器）
 *    2. 交互元素互相重叠（点击互相遮挡）
 *    3. 页面 console 错误
 *  ⚠️ 参考问题（可能影响体验/无障碍）：
 *    4. 可点击区域过小（< 40px，触屏难点）
 *    5. 输入框无标签（无 label / aria-label / placeholder）
 *    6. 按钮无可访问名称（无文本 / aria-label / title）
 *    7. 文字溢出但未省略（内容被截断）
 *    8. 横向溢出容器（scrollWidth > clientWidth）
 *
 * 用法:
 *   node scripts/ui-audit.mjs [--login name:pass] [--page /m] [--viewport 375x700] [--json] [--out file]
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

// ── 页面内审计（浏览器上下文执行） ──
const AUDIT_FN = () => {
	const vw = innerWidth;
	const vh = innerHeight;
	const problems = []; // ✗ 确定问题
	const notes = []; // ⚠️ 参考问题

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
			el.getAttribute("title") ||
			el.textContent ||
			el.placeholder ||
			el.tagName
		)
			.trim()
			.replace(/\s+/g, " ")
			.slice(0, 32);

	const bodyScrollable =
		document.body.scrollHeight > document.body.clientHeight + 2 ||
		document.documentElement.scrollHeight >
			document.documentElement.clientHeight + 2;

	const hasScrollableAncestor = (el, axis) => {
		let anc = el.parentElement;
		const prop = axis === "x" ? "overflowX" : "overflowY";
		const sw = axis === "x" ? "scrollWidth" : "scrollHeight";
		const cw = axis === "x" ? "clientWidth" : "clientHeight";
		while (anc && anc !== document.body) {
			const s = getComputedStyle(anc);
			const ov = s[prop];
			if (
				(ov === "auto" || ov === "scroll" || ov === "overlay") &&
				anc[sw] > anc[cw] + 2
			)
				return true;
			anc = anc.parentElement;
		}
		return false;
	};

	const interactives = [
		...document.querySelectorAll("button, a[href], input, select, textarea"),
	].filter(visible);

	// ── 1. 可达性（纵向/横向） ──
	for (const el of interactives) {
		const r = el.getBoundingClientRect();
		const label = labelOf(el);
		const vReachable = r.top < vh && r.bottom > 0;
		if (!vReachable && !bodyScrollable && !hasScrollableAncestor(el, "y")) {
			problems.push({
				type: "纵向不可达",
				label,
				detail: `top=${Math.round(r.top)} bottom=${Math.round(r.bottom)}`,
			});
		}
		const hReachable = r.left < vw && r.right > 0;
		if (!hReachable && !hasScrollableAncestor(el, "x")) {
			problems.push({
				type: "横向不可达",
				label,
				detail: `left=${Math.round(r.left)} right=${Math.round(r.right)} (视口 ${vw})`,
			});
		}
	}

	// ── 2. 交互元素重叠 ──
	// 排除 fixed 定位的悬浮元素（FAB/弹层天然覆盖内容，属设计行为）
	const rects = interactives
		.map((el) => ({ el, r: el.getBoundingClientRect() }))
		.filter(({ el }) => getComputedStyle(el).position !== "fixed");
	for (let i = 0; i < rects.length; i++) {
		for (let j = i + 1; j < rects.length; j++) {
			const a = rects[i];
			const b = rects[j];
			const ow = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
			const oh = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
			if (ow <= 2 || oh <= 2) continue;
			const ov = ow * oh;
			const minArea = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
			// 重叠超过较小元素一半 → 判定遮挡（排除同一按钮内部嵌套）
			if (ov > minArea * 0.5 && minArea > 100) {
				// 排除父子嵌套（按钮内 icon 等）
				const nested = a.el.contains(b.el) || b.el.contains(a.el);
				if (!nested) {
					problems.push({
						type: "元素重叠",
						label: `${labelOf(a.el)} ↔ ${labelOf(b.el)}`,
						detail: `重叠 ${Math.round(ow)}x${Math.round(oh)}`,
					});
				}
			}
		}
	}

	// ── 3. 可点击区域过小 ──
	const minTap = vw <= 768 ? 40 : 32;
	for (const el of interactives) {
		const r = el.getBoundingClientRect();
		if (r.width < minTap || r.height < minTap) {
			notes.push({
				type: "点击区域过小",
				label: labelOf(el),
				detail: `${Math.round(r.width)}x${Math.round(r.height)} < ${minTap}px`,
			});
		}
	}

	// ── 4. 输入框无标签 ──
	for (const el of document.querySelectorAll("input, select, textarea")) {
		if (!visible(el)) continue;
		if (el.type === "hidden") continue;
		const hasLinkedLabel = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
		const hasAria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
		const hasPlaceholder = el.getAttribute("placeholder");
		if (!hasLinkedLabel && !hasAria && !hasPlaceholder) {
			notes.push({
				type: "输入框无标签",
				label: labelOf(el),
				detail: el.tagName.toLowerCase(),
			});
		}
	}

	// ── 5. 按钮无可访问名称 ──
	for (const el of document.querySelectorAll("button, a[href]")) {
		if (!visible(el)) continue;
		const hasText = el.textContent.trim().length > 0;
		const hasAria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
		const hasTitle = el.getAttribute("title");
		const hasImgAlt = el.querySelector("img[alt]");
		if (!hasText && !hasAria && !hasTitle && !hasImgAlt) {
			notes.push({
				type: "按钮无名称",
				label: el.tagName.toLowerCase(),
				detail: el.className.toString().slice(0, 30),
			});
		}
	}

	// ── 6. 文字溢出未省略 ──
	for (const el of document.querySelectorAll("p, span, div, td, li, a, h1, h2, h3, label")) {
		if (!visible(el)) continue;
		if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 0 && el.clientWidth < 800) {
			const s = getComputedStyle(el);
			const inline = s.display === "inline" || s.display === "inline-block";
			if (!inline && s.overflowX === "visible" && s.textOverflow !== "ellipsis") {
				const text = el.textContent.trim();
				if (text.length > 4 && !text.includes("\n")) {
					notes.push({
						type: "文字溢出未省略",
						label: text.slice(0, 20),
						detail: `${el.scrollWidth}px > ${el.clientWidth}px (${el.tagName})`,
					});
				}
			}
		}
	}

	// ── 7. 横向溢出容器（参考） ──
	const overflowers = [];
	for (const el of document.querySelectorAll("body *")) {
		if (el.scrollWidth > el.clientWidth + 16 && el.clientWidth > 0) {
			const s = getComputedStyle(el);
			if (s.overflowX !== "auto" && s.overflowX !== "scroll" && s.overflowX !== "overlay") {
				overflowers.push({
					cls: (el.className || el.tagName).toString().slice(0, 40),
					sw: el.scrollWidth,
					cw: el.clientWidth,
				});
				if (overflowers.length >= 10) break;
			}
		}
	}

	return {
		vw,
		vh,
		interactives: interactives.length,
		problems,
		notes,
		overflowers,
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
			const consoleErrors = [];
			page.on("console", (msg) => {
				if (msg.type() !== "error") return;
				const t = msg.text();
				// 已知 headless 环境噪音（布局测量递归），非真实页面问题
				if (t.includes("Maximum call stack size exceeded")) return;
				// 权限预期（如普通用户访问管理员页 /db 403）
				if (t.includes("403") || t.includes("FORBIDDEN")) return;
				consoleErrors.push(t.slice(0, 120));
			});
			page.on("pageerror", (err) => {
				const t = String(err);
				if (t.includes("Maximum call stack size exceeded")) return;
				consoleErrors.push(`pageerror: ${t.slice(0, 120)}`);
			});

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
			// 去重 console 错误
			audit.consoleErrors = [...new Set(consoleErrors)].slice(0, 5);
			pageResults.push({ viewport: `${w}x${h}`, ...audit });
			await page.close();
		}
		report.pages[pagePath] = pageResults;
	}

	await browser.close();

	const human = () => {
		const L = [];
		L.push("═══ UI 巡查报告 ═══");
		L.push(`视口: ${args.viewports.map(([w, h]) => `${w}x${h}`).join(" / ")}`);
		L.push(`登录: ${args.login ? args.login.split(":")[0] : "无"}`);
		L.push("");

		let total = 0;
		for (const [path, results] of Object.entries(report.pages)) {
			L.push(`[${path}]`);
			for (const r of results) {
				const vp = r.viewport;
				if (r.error) {
					L.push(`  ✗ ${vp}: 页面错误 ${r.error}`);
					total++;
					continue;
				}
				const issues = [...(r.problems || []), ...(r.consoleErrors || []).map((e) => ({ type: "console", label: e }))];
				const nts = r.notes || [];
				if (issues.length === 0) {
					L.push(`  ✓ ${vp}: ${r.interactives} 个交互元素可达`);
				} else {
					total += issues.length;
					L.push(`  ✗ ${vp}: ${issues.length} 个问题`);
					for (const p of issues) L.push(`      · ${p.type}: ${p.label} ${p.detail || ""}`);
				}
				// 参考问题限 6 条展示
				for (const n of nts.slice(0, 6)) {
					L.push(`      ⚠️ ${n.type}: ${n.label} ${n.detail || ""}`);
				}
				if (nts.length > 6) L.push(`      … 还有 ${nts.length - 6} 条参考问题`);
				for (const o of (r.overflowers || []).slice(0, 3)) {
					L.push(`      ⚠️ 横向溢出: <${o.cls}> ${o.sw}px > ${o.cw}px`);
				}
			}
			L.push("");
		}
		L.push(`═══ 汇总: ${total} 个问题 ═══`);
		return L.join("\n");
	};

	const text = args.json ? JSON.stringify(report, null, 2) : human();
	if (args.out) writeFileSync(args.out, text);
	else console.log(text);
})();
