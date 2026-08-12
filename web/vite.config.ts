/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { NAV_ITEMS } from "./src/app/navigation.ts";

/**
 * 构建时生成 sitemap.xml（数据源自 NAV_ITEMS，路由变更自动保持同步）。
 * 只列出静态路径（排除 :id 模式）。
 */
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
	const apiTarget = env.VITE_API_TARGET ?? "http://localhost:3000";

	return {
		plugins: [solid(), sitemapPlugin(siteUrl)],
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
				"@": fileURLToPath(new URL("./src", import.meta.url)),
				"@app": fileURLToPath(new URL("./src/app", import.meta.url)),
				"@modules": fileURLToPath(new URL("./src/modules", import.meta.url)),
				"@components": fileURLToPath(
					new URL("./src/components", import.meta.url),
				),
				"@lib": fileURLToPath(new URL("./src/lib", import.meta.url)),
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
						if (/(?:marked|katex|highlight\.js|dompurify|marked-)/.test(id)) {
							return "markdown-vendor";
						}
						if (/node_modules\/solid-js/.test(id)) {
							return "solid-vendor";
						}
						return undefined;
					},
				},
			},
		},
	};
});
