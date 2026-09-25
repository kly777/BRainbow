import { describe, expect, it } from "vitest";
import {
	batchAddTagNotice,
	batchDeleteNotice,
	batchUploadNotice,
	singleUploadNotice,
} from "./op-notices.ts";

// 这些串是用户唯一会读到的结果说明。钉住的几条是刻意的措辞判断：
// 命中重复不是失败、一个都没传上去时不能说"上传完成"。

describe("singleUploadNotice", () => {
	it("命中重复走 info（用户没做错什么）", () => {
		expect(singleUploadNotice({ name: "a.png", status: "duplicate" })).toEqual({
			level: "info",
			title: "已存在相同文件",
			message: "「a.png」已在文件列表中",
		});
	});

	it("成功只给标题", () => {
		expect(singleUploadNotice({ name: "a.png", status: "done" })).toEqual({
			level: "success",
			title: "「a.png」上传成功",
			message: "",
		});
	});

	it("被本地拦下时说「未上传」并带上原因", () => {
		expect(
			singleUploadNotice({
				name: "big.mov",
				status: "rejected",
				error: "文件超过 1 GB 上限",
			}),
		).toEqual({
			level: "error",
			title: "未上传",
			message: "文件超过 1 GB 上限",
		});
	});

	it("被拦下但没给原因时有兜底文案", () => {
		const n = singleUploadNotice({ name: "x", status: "rejected" });
		expect(n.message).toBe("文件不符合上传要求");
	});

	it("请求失败说「上传失败」，无原因时兜底「未知错误」", () => {
		expect(
			singleUploadNotice({ name: "x", status: "error", error: "网络断了" })
				.message,
		).toBe("网络断了");
		expect(singleUploadNotice({ name: "x", status: "error" }).message).toBe(
			"未知错误",
		);
	});
});

describe("batchUploadNotice", () => {
	it("全部成功：success + 计数", () => {
		expect(
			batchUploadNotice({ ok: 3, duplicated: 0, failed: 0, rejected: 0 }),
		).toEqual({
			level: "success",
			title: "上传完成",
			message: "成功 3 个",
		});
	});

	it("有失败：error，且把四类都数清楚", () => {
		expect(
			batchUploadNotice({ ok: 1, duplicated: 2, failed: 3, rejected: 4 }),
		).toEqual({
			level: "error",
			title: "上传完成（有失败）",
			message: "成功 1 个，已存在 2 个，失败 3 个，未上传 4 个",
		});
	});

	it("一个都没传上去时标题不能是「上传完成」", () => {
		const n = batchUploadNotice({
			ok: 0,
			duplicated: 0,
			failed: 0,
			rejected: 2,
		});
		expect(n.level).toBe("error");
		expect(n.title).toBe("未上传");
	});

	it("有成功的也有未上传：标题点明「有未上传」", () => {
		const n = batchUploadNotice({
			ok: 2,
			duplicated: 0,
			failed: 0,
			rejected: 1,
		});
		expect(n.level).toBe("error");
		expect(n.title).toBe("上传完成（有未上传）");
		expect(n.message).toBe("成功 2 个，未上传 1 个");
	});
});

describe("batchDeleteNotice", () => {
	it("全部删除：success", () => {
		expect(batchDeleteNotice({ ok: 2, skipped: 0, failed: 0 })).toEqual({
			level: "success",
			title: "批量删除完成",
			message: "已删除 2 个",
		});
	});

	it("被引用跳过要单独报出来（用户可以逐个强制删）", () => {
		const n = batchDeleteNotice({ ok: 1, skipped: 2, failed: 0 });
		expect(n.level).toBe("success");
		expect(n.message).toBe("已删除 1 个，被引用跳过 2 个");
	});

	it("有失败时改成 error 级别", () => {
		const n = batchDeleteNotice({ ok: 1, skipped: 0, failed: 1 });
		expect(n.level).toBe("error");
		expect(n.title).toBe("批量删除完成（有失败）");
	});
});

describe("batchAddTagNotice", () => {
	it("全部成功：带上标签名与数量", () => {
		expect(batchAddTagNotice({ ok: 3, failed: 0, name: "旅行" })).toEqual({
			level: "success",
			title: "批量加标签完成",
			message: "已为 3 个文件加上「旅行」",
		});
	});

	it("有失败：error 且给出成败计数", () => {
		expect(batchAddTagNotice({ ok: 2, failed: 1, name: "旅行" })).toEqual({
			level: "error",
			title: "批量加标签完成（有失败）",
			message: "成功 2 个，失败 1 个",
		});
	});
});
