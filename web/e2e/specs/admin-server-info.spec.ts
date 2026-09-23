// ── /admin：服务器信息卡片的页面级冒烟 ──
import { expect, test } from "@playwright/test";
import { mockApi } from "../fixtures/api.ts";

const GiB = 1024 ** 3;

// /admin 是角色门控页：这条用例把登录态换成 admin（其它用例是普通 user）
test.use({
	storageState: {
		cookies: [],
		origins: [
			{
				origin: "http://localhost:3001",
				localStorage: [
					{
						name: "brainbow_user",
						value: JSON.stringify({
							id: 1,
							name: "e2e-admin",
							role: "admin",
							token: "e2e-token",
						}),
					},
				],
			},
		],
	},
});

/** 夹具：数字都取整，断言才不脆弱 */
const systemInfo = {
	version: "0.1.0",
	uptime_secs: 3600,
	db_version: 19,
	db_page_count: 1000,
	db_page_size: 4096,
	db_size_bytes: 174 * 1024 * 1024,
	stats: {
		users: 1,
		tasks: 2,
		cards: 3,
		memories: 4,
		bookmarks: 5,
		articles: 6,
		conversations: 7,
		chat_trees: 8,
		ontologies: 9,
	},
	server: {
		cpu_count: 4,
		load: { one: 0.12, five: 0.08, fifteen: 0.05 },
		memory: {
			total_bytes: 8 * GiB,
			available_bytes: 5 * GiB,
			used_bytes: 3 * GiB,
		},
		disk: { total_bytes: 40 * GiB, free_bytes: 30 * GiB, used_bytes: 10 * GiB },
		uploads: {
			files: 35,
			bytes: GiB,
			newest_modified: "2026-09-23T12:00:00+00:00",
		},
		thumbs: { files: 29, bytes: 3 * 1024 * 1024, newest_modified: null },
		favicons: { files: 281, bytes: 5 * 1024 * 1024, newest_modified: null },
		backups: {
			files: 20,
			bytes: 2 * GiB,
			newest_modified: "2026-09-23T12:45:20+00:00",
		},
		backup_dir: "/opt/brb/backup",
	},
};

test("服务器卡片把内存 / CPU / 磁盘 / 上传 / 备份的用量都显示出来", async ({
	page,
}) => {
	await mockApi(page, [
		{
			path: "/api/admin/settings",
			body: { allow_register: false, jwt_secret_set: true, jwt_secret_len: 72 },
		},
		{ path: "/api/admin/system-info", body: systemInfo },
	]);

	await page.goto("/admin");

	// 内存与磁盘：分子 / 分母（百分比）。GB 一律两位小数（formatBytes 的口径）
	await expect(page.getByText("3.00 GB / 8.00 GB（38%）")).toBeVisible();
	await expect(page.getByText("10.00 GB / 40.00 GB（25%）")).toBeVisible();
	// CPU：核心数 + 三个负载
	await expect(page.getByText("4 核")).toBeVisible();
	await expect(page.getByText(/0\.12 \/ 0\.08 \/ 0\.05/)).toBeVisible();
	// 备份：份数靠文件数报（这个目录一份就是一个文件），并给出最近一次时间
	await expect(page.getByText("2.00 GB（20 份）")).toBeVisible();
	await expect(page.getByText("备份目录：/opt/brb/backup")).toBeVisible();
	// 上传：总量 + 其中可再生的两份缓存
	await expect(page.getByText("1.00 GB（35 个文件）")).toBeVisible();
	await expect(page.getByText(/缩略图缓存 3.0 MB（29 个文件）/)).toBeVisible();
});

test("读不到的项显示 —，而不是 0", async ({ page }) => {
	await mockApi(page, [
		{
			path: "/api/admin/settings",
			body: { allow_register: false, jwt_secret_set: true, jwt_secret_len: 72 },
		},
		{
			path: "/api/admin/system-info",
			// 非 Linux（没有 /proc）且没配备份目录：这正是开发机的样子
			body: {
				...systemInfo,
				server: {
					...systemInfo.server,
					load: null,
					memory: null,
					disk: null,
					backups: null,
					backup_dir: null,
				},
			},
		},
	]);

	await page.goto("/admin");

	// 内存与磁盘两格是"—"
	await expect(page.getByText("—").first()).toBeVisible();
	await expect(page.getByText("2.00 GB（20 份）")).toHaveCount(0);
	// "为什么是 —、怎么配"这类说明收进了 ⓘ 气泡：悬浮才出现（键盘用户 Tab 也行）
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await page.getByRole("button", { name: "关于备份统计" }).hover();
	await expect(page.getByRole("tooltip")).toContainText("BACKUP_DIR");
});
