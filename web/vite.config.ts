import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin()],
    server: {
        port: 3001,
        open: true,
        proxy: {
            "/api":"http://localhost:3000"
        },
    },
    build: {
        target: "esnext",
        outDir: "dist",
        emptyOutDir: true,
    },
});
