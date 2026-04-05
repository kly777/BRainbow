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
    },
    output: {
        distPath: {
            root: path.resolve(__dirname, "../dist"),
        },
        cleanDistPath: true,
    }
});
