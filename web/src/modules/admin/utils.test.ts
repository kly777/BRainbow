import { describe, expect, it } from "vitest";
import type { ModuleStats } from "./api.ts";
import { formatBytes, formatUptime, getStatValue } from "./utils.ts";

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
