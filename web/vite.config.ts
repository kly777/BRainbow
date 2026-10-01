/// <reference types="vitest" />

import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { generateAll } from "./scripts/generate-seo.ts";

/** 构建完成后生成 SEO/Agent 产物（sitemap / robots / llms / md pages） */
function seoPlugin(siteUrl: string): Plugin {
	return {
		name: "brainbow:seo",
		apply: "build",
		closeBundle() {
			generateAll(siteUrl);
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
		plugins: [solid(), seoPlugin(siteUrl)],
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
			// ── 测试环境按文件分（实测：同一批纯函数测试 jsdom 9.8s vs node 3.5s）──
			//
			// 规则：**`.test.ts` → node，`.test.tsx` → jsdom**。渲染测试都是 `.tsx`，
			// 纯逻辑测试都是 `.ts`；少数需要 DOM 的 `.ts`（hook / 事件 / 剪贴板之类）
			// 在文件头自己声明 `// @vitest-environment jsdom`，环境不对会立刻报
			// `window is not defined`，不会静默。
			//
			// 为什么根配置也要写 `environment: "node"`：`vite-plugin-solid` 只在
			// **用户配置没写 environment 时**才把默认设成 jsdom（见其 dist 里的
			// `if (!userTest.environment && !options.ssr)`）—— 不显式写，jsdom 就会
			// 变成全局默认，纯逻辑测试白付一份 jsdom 启动开销。
			//
			// 实测（197 文件 / 1599 用例）：全 jsdom 44.8s（environment 累计 354s）
			// → 本配置 35.5s（environment 176s）。多 project 会让共享模块被两个
			// project 各 transform 一次，但净收益仍然明显（9s）。
			environment: "node",
			// jsdom 的缺口在 vitest.setup.ts 里集中补（见该文件顶部说明）：
			// 不补的话那些抛错会被记成 unhandled error，让整条测试命令永远非零退出
			setupFiles: ["./vitest.setup.ts"],
			// 12 个 worker：本机 16 核 / 7.6GB 内存，jsdom worker 是内存大户，
			// 默认并发（实测 41s）没吃满 CPU；12 是实测 35.5s 且内存仍有余量的点。
			// 与 cargo 的 jobs=8 同一类取舍（都是"别把 swap 吃穿"）。
			maxWorkers: 12,
			projects: [
				{
					extends: true,
					test: {
						name: "node",
						environment: "node",
						include: ["src/**/*.test.ts"],
					},
				},
				{
					extends: true,
					test: {
						name: "jsdom",
						environment: "jsdom",
						include: ["src/**/*.test.tsx"],
					},
				},
			],
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
					codeSplitting: {
						minSize: 4096,
						groups: [
							// Tier 1: 大型 vendor 库，独立缓存（优先级最高）
							{
								name: "katex",
								test: /node_modules[\\/]katex/,
								priority: 20,
							},
							{
								name: "markdown-vendor",
								test: /node_modules[\\/](marked|highlight\.js|dompurify|marked-)/,
								priority: 20,
							},
							// Tier 2: 业务模块，entriesAware 按路由入口自动拆分共享/独占代码
							{
								name: "mem",
								test: /src[\\/]modules[\\/]mem[\\/]/,
								priority: 10,
								entriesAware: true,
							},
							{
								name: "task",
								test: /src[\\/]modules[\\/]task[\\/]/,
								priority: 10,
								entriesAware: true,
							},
						],
					},
				},
			},
		},
	};
});
