/// <reference types="vitest" />

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import purgecss from "vite-plugin-purgecss";
import solid from "vite-plugin-solid";
import { NAV_ITEMS } from "./src/config/navigation.ts";

// ═══════════════════════════════════════════
// SEO/Agent 产物构建插件（数据源自 NAV_ITEMS + VITE_SITE_URL，路由变更自动同步）
// ═══════════════════════════════════════════

/** 站点地图：静态路径（排除 :id 模式），输出 dist/sitemap.xml */
function sitemapPlugin(siteUrl: string): Plugin {
	return {
		name: "brainbow:sitemap",
		apply: "build",
		closeBundle() {
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
		},
	};
}

/** 静态 SEO 资产：scripts/seo-assets/ 模板渲染（@@SITE_URL@@ → 站点域名） */
function seoAssetsPlugin(siteUrl: string): Plugin {
	// 模板文件 → dist 相对路径
	const SEO_ASSETS = [
		["robots.txt", "robots.txt"],
		["llms.txt", "llms.txt"],
		["openapi.json", "openapi.json"],
		["api-catalog", path.join(".well-known", "api-catalog")],
	] as const;

	return {
		name: "brainbow:seo-assets",
		apply: "build",
		closeBundle() {
			for (const [src, dst] of SEO_ASSETS) {
				const tpl = readFileSync(
					path.join("scripts", "seo-assets", src),
					"utf8",
				);
				const outFile = path.join("dist", dst);
				mkdirSync(path.dirname(outFile), { recursive: true });
				writeFileSync(outFile, tpl.replaceAll("@@SITE_URL@@", siteUrl));
			}
		},
	};
}

/** Markdown for Agents：每路径一个 .md（dist/_md/<path>.md），模板 scripts/seo-assets/*.md */
function markdownPagesPlugin(siteUrl: string): Plugin {
	return {
		name: "brainbow:markdown-pages",
		apply: "build",
		closeBundle() {
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
		},
	};
}

export default defineConfig(({ command, mode }) => {
	// 配置读取项目根目录的 .env.dev / .env.prod（package.json 用 --mode dev/prod 选择）
	const envDir = fileURLToPath(new URL("..", import.meta.url));
	const env = loadEnv(mode, envDir, "");

	// 站点域名：用于生成 sitemap.xml 的绝对 URL（VITE_SITE_URL，缺省回退生产域名）
	const siteUrl = (env.VITE_SITE_URL ?? "https://brainbow.top").replace(
		/\/+$/,
		"",
	);
	// 开发服务器端口与后端代理目标（VITE_PORT / VITE_API_TARGET）
	const port = Number(env.VITE_PORT ?? 3001);
	// 配置 fail-fast：端口非法时立即报错，而不是静默回退
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`VITE_PORT 无效: ${env.VITE_PORT}`);
	}
	const apiTarget = env.VITE_API_TARGET ?? "http://localhost:3000";

	return {
		plugins: [
			solid(),
			sitemapPlugin(siteUrl),
			seoAssetsPlugin(siteUrl),
			markdownPagesPlugin(siteUrl),
			purgecss({
				content: [
					"./src/**/*.tsx",
					"./src/**/*.ts",
					"./index.html",
				],
				safelist: {
					standard: [/^data-/, /^aria-/],
				},
			}),
		],
		envDir,

		css: {
			modules: {
				localsConvention: "camelCaseOnly",
				// dev 模式类名带文件名，build 用短 hash
				generateScopedName: command === "serve" ? "[name]__[local]" : undefined,
			},
			// build 的 CSS minify 用 vite 默认的 lightningcss：
			// 按内置现代基线（chrome111/safari16.4 等）自动生成/规范化前缀，
			// 本项目兼容性要求低，无需 autoprefixer 按 browserslist 加旧前缀
		},

		test: {
			include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		},

		resolve: {
			alias: {
				"@app": fileURLToPath(new URL("./src/app", import.meta.url)),
				"@modules": fileURLToPath(new URL("./src/modules", import.meta.url)),
				"@components": fileURLToPath(
					new URL("./src/components", import.meta.url),
				),
				// tsconfig 同时放行 @components 与 @components/*，vite 需等价映射
				// 否则子路径导入构建期解析失败（审计 E2）
				"@components/": fileURLToPath(
					new URL("./src/components/", import.meta.url),
				),
				"@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
				"@config": fileURLToPath(new URL("./src/config", import.meta.url)),
			},
		},

		server: {
			port,
			hmr: {
				host: "localhost",
			},
			proxy: {
				"/api": {
					target: apiTarget,
					changeOrigin: true,
					// SSE 流式响应需要长连接：不设 timeout，避免 AI 思考间隔被切断
				},
				"/uploads": {
					target: apiTarget,
					changeOrigin: true,
					timeout: 5000,
				},
			},
		},

		build: {
			outDir: "dist",
			emptyOutDir: true,
			// JS 兼容基线 = vite 默认的 baseline-widely-available（2026-01-01 基线）：
			// chrome111 / edge111 / firefox114 / safari16.4 / ios16.4
			// 与 lightningcss 的 CSS 基线一致，显式写出便于调整
			target: ["chrome111", "edge111", "firefox114", "safari16.4", "ios16.4"],
			// 生产不开 sourcemap（内网工具，无排障收益，省一半产物体积）
			sourcemap: false,
			rolldownOptions: {
				output: {
					manualChunks(id) {
						// 富文本渲染工具链独立成包：体积大且极少变更，拆出利于长缓存
						if (/(?:marked|highlight\.js|dompurify|marked-)/.test(id)) {
							return "markdown-vendor";
						}
						// katex 独立成包：数学公式渲染，按需加载
						if (/katex/.test(id)) {
							return "katex";
						}
						if (/node_modules\/solid-js/.test(id)) {
							return "solid-vendor";
						}
						// 共享模块拆分：UI 组件、工具函数、任务模块
						if (/src\/components\/ui/.test(id)) {
							return "shared-ui";
						}
						if (/src\/shared\/utils/.test(id)) {
							return "shared-utils";
						}
						if (/src\/modules\/task\/(api|hooks|lib)/.test(id)) {
							return "task-shared";
						}
						// mem 模块拆分：hooks 和 API 独立
						if (/src\/modules\/mem\/(api|hooks)/.test(id)) {
							return "mem-shared";
						}
						// mem 模块拆分：复习页面和管理页面分离
						if (/src\/modules\/mem\/(MemPage|components\/(ReviewCard|Sidebar|ContextBar|FilterBar|MnemonicSettingsModal))/.test(id)) {
							return "mem-review";
						}
						if (/src\/modules\/mem\/(MemManage|MemAdd|components\/(ManageTable|ManageDetail|ManageBatchBar|ImportParts|MemBatchTagModal|MemExportModal))/.test(id)) {
							return "mem-manage";
						}
						// task 模块拆分：不同视图分离
						if (/src\/modules\/task\/components\/TaskCalendar/.test(id)) {
							return "task-calendar";
						}
						if (/src\/modules\/task\/components\/TaskKanban/.test(id)) {
							return "task-kanban";
						}
						if (/src\/modules\/task\/components\/TaskDag/.test(id)) {
							return "task-dag";
						}
						return undefined;
					},
				},
			},
		},
	};
});