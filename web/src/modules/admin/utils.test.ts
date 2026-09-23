import { describe, expect, it } from "vitest";
import type { DirUsage, ModuleStats } from "./api.ts";
import {
	formatBackupUsage,
	formatBytes,
	formatDirUsage,
	formatIsoLocal,
	formatUptime,
	formatUsage,
	getStatValue,
	usagePercent,
} from "./utils.ts";

describe("formatUptime", () => {
	it("秒", () => {
		expect(formatUptime(0)).toBe("0 秒");
		expect(formatUptime(30)).toBe("30 秒");
		expect(formatUptime(59)).toBe("59 秒");
	});

	it("分钟", () => {
		expect(formatUptime(60)).toBe("1 分钟");
		expect(formatUptime(900)).toBe("15 分钟");
		expect(formatUptime(3599)).toBe("59 分钟");
	});

	it("小时 + 分钟", () => {
		expect(formatUptime(3600)).toBe("1 小时 0 分钟");
		expect(formatUptime(5400)).toBe("1 小时 30 分钟");
		expect(formatUptime(86399)).toBe("23 小时 59 分钟");
	});

	it("天 + 小时", () => {
		expect(formatUptime(86400)).toBe("1 天 0 小时");
		expect(formatUptime(90000)).toBe("1 天 1 小时");
		expect(formatUptime(172800)).toBe("2 天 0 小时");
	});
});

describe("formatBytes", () => {
	it("字节", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1023)).toBe("1023 B");
	});

	it("KB", () => {
		expect(formatBytes(1024)).toBe("1.0 KB");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(1048575)).toBe("1024.0 KB");
	});

	it("MB", () => {
		expect(formatBytes(1048576)).toBe("1.0 MB");
		expect(formatBytes(5242880)).toBe("5.0 MB");
	});

	it("GB", () => {
		expect(formatBytes(1073741824)).toBe("1.00 GB");
		expect(formatBytes(2147483648)).toBe("2.00 GB");
	});
});

describe("getStatValue", () => {
	const stats: ModuleStats = {
		users: 5,
		tasks: 42,
		cards: 128,
		memories: 256,
		bookmarks: 30,
		articles: 12,
		conversations: 8,
		chat_trees: 15,
		ontologies: 3,
	};

	it("返回指定 key 的值", () => {
		expect(getStatValue(stats, "users")).toBe(5);
		expect(getStatValue(stats, "tasks")).toBe(42);
		expect(getStatValue(stats, "cards")).toBe(128);
	});

	it("返回0值", () => {
		const empty = { ...stats, users: 0 };
		expect(getStatValue(empty, "users")).toBe(0);
	});
});

describe("服务器用量文案", () => {
	const usage: DirUsage = {
		files: 35,
		bytes: 1073741824,
		newest_modified: "2026-09-23T12:45:20+00:00",
	};

	it("percentage 取整；分母非正时是 null（不是 0%）", () => {
		expect(usagePercent(50, 100)).toBe(50);
		expect(usagePercent(1, 3)).toBe(33);
		expect(usagePercent(4, 4)).toBe(100);
		expect(usagePercent(0, 0)).toBeNull();
		expect(usagePercent(5, 0)).toBeNull();
	});

	it("内存/磁盘：分子 / 分母（百分比）", () => {
		expect(formatUsage(1073741824, 2147483648)).toBe(
			"1.00 GB / 2.00 GB（50%）",
		);
		// 总量读不到时只报绝对量，不硬凑百分比
		expect(formatUsage(1073741824, 0)).toBe("1.00 GB / 0 B");
	});

	it("目录占用：拿不到就是 —（不是 0 B）", () => {
		expect(formatDirUsage(usage)).toBe("1.00 GB（35 个文件）");
		expect(formatDirUsage(null)).toBe("—");
		expect(formatBackupUsage(usage)).toBe("1.00 GB（35 份）");
		expect(formatBackupUsage(null)).toBe("—");
	});

	it("ISO 时间补 Z 后按本地时区显示；拿不到就是 —", () => {
		const text = formatIsoLocal("2026-09-23T12:45:20+00:00");
		expect(text).not.toBe("—");
		expect(text).toContain("2026");
		expect(formatIsoLocal(null)).toBe("—");
		// 认不出来的原样返回，别显示 Invalid Date
		expect(formatIsoLocal("不是时间")).toBe("不是时间");
	});
});
