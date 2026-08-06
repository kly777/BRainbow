/// <reference types="vitest" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { fileURLToPath } from "node:url";

export default defineConfig({
	plugins: [solid()],

	css: {
		modules: {
			localsConvention: "camelCaseOnly",
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
      "@components": fileURLToPath(new URL("./src/components", import.meta.url)),
      "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
      "@apis": fileURLToPath(new URL("./src/apis", import.meta.url)),
      "@auth": fileURLToPath(new URL("./src/auth", import.meta.url)),
      "@lib": fileURLToPath(new URL("./src/lib", import.meta.url)),
      "@pages": fileURLToPath(new URL("./src/pages", import.meta.url)),
      "@styles": fileURLToPath(new URL("./src/styles", import.meta.url)),
      "@types": fileURLToPath(new URL("./src/types", import.meta.url)),
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
        timeout: 5000,
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
});
