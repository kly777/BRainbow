// ── 页面级 e2e（Playwright）──
//
// 形态是刻意挑的：**只起前端 dev server + 在浏览器层造接口 + 注入假 token**。
// 理由：确定性（不依赖后端编译、不依赖种子数据）、快（几秒）、干净（不往 dev 库写
// 东西），而且同一套断言以后能演化成对生产的只读冒烟。
//
// 它测的是"页面自己有没有坏"（元素在不在、点得动吗、条数对不对），**测不到后端
// 契约变化**（字段改名、分页语义）—— 后者归 Rust 侧测试与 `just health`。
import { defineConfig, devices } from "@playwright/test";

/** 与 .env.dev 的 VITE_PORT 一致 */
const PORT = 3001;
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "./e2e/specs",
	globalSetup: "./e2e/auth.setup.ts",
	fullyParallel: true,
	// 不重试：冒烟的价值在于"红就是红"，重试只会掩盖不稳
	retries: 0,
	reporter: [["list"]],
	use: {
		baseURL: BASE,
		storageState: "e2e/.auth/state.json",
		// 失败时留一份可回放的 trace（pnpm exec playwright show-trace …）
		trace: "retain-on-failure",
		reducedMotion: "reduce",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				// 视口必须钉在**项目这一层**：devices 预设自带的 viewport 会盖掉上层的
				// use（踩过：以为设了 1440，实际是 1280，瀑布流的列数与断言全对不上）。
				// 固定宽高是为了可复现 —— 列数、"要不要继续加载"都跟着宽度走。
				viewport: { width: 1440, height: 900 },
			},
		},
	],
	webServer: {
		// 只要前端：接口由每条用例自己 route 造假，所以不需要后端与种子数据
		command: "pnpm run dev",
		url: BASE,
		// 本地已经开着 dev server 时直接用，不抢端口、不重复起
		reuseExistingServer: true,
		stdout: "ignore",
		timeout: 60_000,
	},
});
