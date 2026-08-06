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
