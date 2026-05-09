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
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  server: {
    port: 3001,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        timeout: 5000,
      },
      "/uploads": {
        target: "http://localhost:8080",
        changeOrigin: true,
        timeout: 5000,
      },
    },
  },
  output: {
    distPath: {
      root: "dist",
    },
    cleanDistPath: true,
  },
});
