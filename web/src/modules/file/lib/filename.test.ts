import { describe, expect, it } from "vitest";
import { fileExt } from "./filename.ts";

describe("fileExt", () => {
	it("提取常见后缀并大写", () => {
		expect(fileExt("report.pdf")).toBe("PDF");
		expect(fileExt("photo.PNG")).toBe("PNG");
		expect(fileExt("表格.xlsx")).toBe("XLSX");
	});

	it("多点文件名取最后一段", () => {
		expect(fileExt("archive.tar.gz")).toBe("GZ");
		expect(fileExt("my.file.name.md")).toBe("MD");
	});

	it("无后缀返回空串", () => {
		expect(fileExt("README")).toBe("");
		expect(fileExt(".gitignore")).toBe(""); // 隐藏文件不算后缀
		expect(fileExt("trailing.")).toBe("");
		expect(fileExt("")).toBe("");
	});

	it("超长后缀截断到 5 字符", () => {
		expect(fileExt("data.jpeg2000")).toBe("JPEG2");
	});
});
