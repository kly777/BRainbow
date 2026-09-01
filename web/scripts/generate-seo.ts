/**
 * SEO/Agent 产物生成（数据源自 NAV_ITEMS + VITE_SITE_URL，路由变更自动同步）
 * 被 vite.config.ts 在 build closeBundle 中调用，也可独立运行。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NAV_ITEMS } from "../src/config/navigation.ts";

/** 站点地图：静态路径（排除 :id 模式），输出 dist/sitemap.xml */
export function generateSitemap(siteUrl: string): void {
	const urls = NAV_ITEMS.filter((i) => !i.path.includes(":"))
		.map((i) => `  <url><loc>${siteUrl}${i.path}</loc></url>`)
		.join("\n");
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
	mkdirSync("dist", { recursive: true });
	writeFileSync("dist/sitemap.xml", xml);
}

/** 静态 SEO 资产：scripts/seo-assets/ 模板渲染（@@SITE_URL@@ → 站点域名） */
export function generateSeoAssets(siteUrl: string): void {
	const SEO_ASSETS = [
		["robots.txt", "robots.txt"],
		["llms.txt", "llms.txt"],
		["openapi.json", "openapi.json"],
		["api-catalog", path.join(".well-known", "api-catalog")],
	] as const;

	for (const [src, dst] of SEO_ASSETS) {
		const tpl = readFileSync(path.join("scripts", "seo-assets", src), "utf8");
		const outFile = path.join("dist", dst);
		mkdirSync(path.dirname(outFile), { recursive: true });
		writeFileSync(outFile, tpl.replaceAll("@@SITE_URL@@", siteUrl));
	}
}

/** Markdown for Agents：每路径一个 .md（dist/_md/<path>.md），模板 scripts/seo-assets/*.md */
export function generateMarkdownPages(siteUrl: string): void {
	const mdDir = path.join("dist", "_md");
	mkdirSync(mdDir, { recursive: true });

	// 首页：功能列表由 NAV_ITEMS 派生
	const features = NAV_ITEMS.filter((i) => i.nav && i.path !== "/")
		.map((i) => `- [${i.label}](${siteUrl}${i.path}): ${i.desc}`)
		.join("\n");
	const homeTpl = readFileSync(
		path.join("scripts", "seo-assets", "home.md"),
		"utf8",
	);
	writeFileSync(
		path.join(mdDir, "index.md"),
		homeTpl.replaceAll("@@FEATURES@@", features),
	);

	// 功能页：每个静态路径一份
	const pageTpl = readFileSync(
		path.join("scripts", "seo-assets", "page.md"),
		"utf8",
	);
	for (const item of NAV_ITEMS) {
		if (item.path === "/" || item.path.includes(":")) continue;
		const rel = item.path.slice(1);
		const file = path.join(mdDir, `${rel}.md`);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(
			file,
			pageTpl
				.replaceAll("@@TITLE@@", item.title)
				.replaceAll("@@DESC@@", item.desc || item.title)
				.replaceAll("@@LABEL@@", item.label)
				.replaceAll("@@SITE_URL@@", siteUrl),
		);
	}
}

/** 一次性生成全部 SEO/Agent 产物 */
export function generateAll(siteUrl: string): void {
	const cleanUrl = siteUrl.replace(/\/+$/, "");
	generateSitemap(cleanUrl);
	generateSeoAssets(cleanUrl);
	generateMarkdownPages(cleanUrl);
}
