import path from "node:path";
import { defineConfig } from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";
import { pluginSolid } from "@rsbuild/plugin-solid";
import { pluginTypeCheck } from "@rsbuild/plugin-type-check";

export default defineConfig({
	plugins: [
		pluginTypeCheck(),
		pluginBabel({
			include: /\.(?:jsx|tsx)$/,
		}),
		pluginSolid(),
	],
	html: {
		template: "./index.html",
		tags: [
			// 解决 Cloudflare 的 Rocket Loader 与 SolidJS 不兼容
			{ tag: "script", attrs: { "data-cfasync": "false" } },
		],
	},
	source: {
		entry: {
			index: "./src/index.tsx",
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	server: {
		port: 3001,
		proxy: {
			"/api": {
				target: "http://localhost:8080",
				changeOrigin: true,
			},
		},
	},
	output: {
		distPath: {
			root: path.resolve(__dirname, "./dist"),
		},
		cleanDistPath: true,
    }
});
