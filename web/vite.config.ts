/// <reference types="vitest" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [solid(), vanillaExtractPlugin({ identifiers: "debug" })],

  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
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
