import { defineConfig } from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";
import { pluginSolid } from "@rsbuild/plugin-solid";

export default defineConfig({
    plugins: [
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
});
