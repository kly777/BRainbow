/// <reference types="vitest" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => ({
	plugins: [solid()],

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
			// ── FSD 层 alias ──
			"@app": fileURLToPath(new URL("./src/app", import.meta.url)),
			"@pages": fileURLToPath(new URL("./src/pages", import.meta.url)),
			"@features": fileURLToPath(new URL("./src/features", import.meta.url)),
			"@entities": fileURLToPath(new URL("./src/entities", import.meta.url)),
			"@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
		},
	},

	server: {
		port: 3001,
		hmr: {
			host: "localhost",
		},
		proxy: {
			"/api": {
				target: "http://localhost:3000",
				changeOrigin: true,
				// SSE 流式响应需要长连接：不设 timeout，避免 AI 思考间隔被切断
			},
			"/uploads": {
				target: "http://localhost:3000",
				changeOrigin: true,
				timeout: 5000,
			},
		},
	},

	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
}));
